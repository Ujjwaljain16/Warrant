'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runProcess, scrubbedEnv } = require('../util/proc');
const { MAX_ARTIFACT_BYTES } = require('../engine/envelope');
const { redact } = require('../util/redact');

/**
 * Real worker: runs `task.exec.argv` as a subprocess inside a fresh per-attempt directory.
 *
 *  - no shell: argv is passed straight to the OS;
 *  - environment is scrubbed (see util/proc.js) plus a handful of WARRANT_* variables describing the attempt;
 *  - the working directory is the attempt directory; declared outputs are read back from there;
 *  - output files that are symlinks, not regular files, or oversized are refused;
 *  - the engine's deadline/cancel signal kills the whole process tree.
 *
 * Not a sandbox: the process runs as the current user (docs/THREAT_MODEL.md, residual risks).
 */
class CommandWorker {
  constructor({ baseDir, specDir = null, maxOutputBytes = 1 << 20 }) {
    if (typeof baseDir !== 'string' || !baseDir) throw new TypeError('baseDir is required');
    this.baseDir = path.resolve(baseDir);
    this.specDir = specDir ? path.resolve(specDir) : null;
    this.maxOutputBytes = maxOutputBytes;
  }

  // Arguments beginning with ./ or ../ are paths relative to the spec file, so specs can name their scripts portably.
  _resolveArgs(argv) {
    return argv.map((arg, i) => (i > 0 && this.specDir && /^..?[\/]/.test(arg) ? path.resolve(this.specDir, arg) : arg));
  }

  attemptDir(runId, attemptId) {
    const dir = path.resolve(this.baseDir, runId, attemptId);
    // run ids and attempt ids are validated identifiers (no separators), but containment is checked anyway.
    if (!dir.startsWith(this.baseDir + path.sep)) throw new Error('attempt directory escapes the base directory');
    return dir;
  }

  // Directory used both to run the attempt and as the working directory of command verifiers.
  workDirFor({ runId, attemptId }) {
    return this.attemptDir(runId, attemptId);
  }

  async execute(info, ctx) {
    const { attemptId, taskId, task } = info;
    if (!task.exec) {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'NO_EXEC', retryable: false });
      return;
    }
    const dir = this.attemptDir(info.runId, attemptId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify({
      task: taskId, attempt: info.attemptNo, inputs: info.inputs, idempotency_key: info.idempotencyKey, outputs: task.outputs,
      // Where each dependency's *accepted* (gate-verified) output lives, so commands can read real upstream data.
      dep_dirs: Object.fromEntries(Object.entries(info.depAttempts || {}).map(([dep, attempt]) => [dep, this.attemptDir(info.runId, attempt)])),
    }));
    const result = await runProcess({
      argv: this._resolveArgs(task.exec.argv),
      cwd: dir,
      timeoutMs: (task.deadline_ms || 60_000) + 1000, // backstop only; the engine's own deadline normally fires first
      maxOutputBytes: this.maxOutputBytes,
      signal: ctx.signal,
      env: {
        ...scrubbedEnv(),
        WARRANT_ATTEMPT_DIR: dir,
        WARRANT_TASK: taskId,
        WARRANT_ATTEMPT: String(info.attemptNo),
        WARRANT_IDEMPOTENCY_KEY: info.idempotencyKey,
      },
    });
    if (result.aborted) return; // cancelled or timed out by the engine: say nothing
    if (result.spawnError) {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'SPAWN_ERROR', retryable: false });
      return;
    }
    if (result.truncated) {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'OUTPUT_LIMIT', retryable: false });
      return;
    }
    if (result.timedOut) return; // backstop expired; the engine's deadline will have handled it
    if (result.exitCode !== 0) {
      // Keep the tail of stderr for humans in the attempt directory, not in the run log.
      fs.writeFileSync(path.join(dir, 'stderr.txt'), redact(result.stderr, 4000));
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'EXIT_NONZERO', retryable: true });
      return;
    }
    const artifacts = {};
    for (const name of task.outputs) {
      const body = this._readOutput(dir, name);
      if (body !== null) artifacts[name] = body;
    }
    ctx.deliver({ attemptId, claim: 'success', artifacts });
  }

  _readOutput(dir, name) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (_error) { return null; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) return null;
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) return null;
    return fs.readFileSync(real, 'utf8');
  }
}

module.exports = Object.freeze({ CommandWorker });
