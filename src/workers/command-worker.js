'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runProcess, scrubbedEnv } = require('../util/proc');
const { digestArtifacts } = require('../core/gate');
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
    const depDirs = this._freezeDependencies(info, dir);
    if (depDirs.error) {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: depDirs.error, retryable: false });
      return;
    }
    fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify({
      task: taskId, attempt: info.attemptNo, inputs: info.inputs, idempotency_key: info.idempotencyKey, outputs: task.outputs,
      // Where each dependency's *accepted* (gate-verified) output lives, so commands can read real upstream data.
      dep_dirs: depDirs.dirs,
    }));
    this._prepare(info, dir);
    const result = await runProcess({
      argv: this._resolveArgs(task.exec.argv),
      cwd: dir,
      timeoutMs: (task.deadline_ms || 60_000) + 1000, // backstop only; the engine's own deadline normally fires first
      maxOutputBytes: this.maxOutputBytes,
      signal: ctx.signal,
      onSpawn: (pid) => this._onSpawn(info, dir, pid),
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
    this._onExit(info, dir, result);
    if (result.exitCode !== 0) {
      // Keep the tail of stderr for humans in the attempt directory, not in the run log.
      fs.writeFileSync(path.join(dir, 'stderr.txt'), redact(result.stderr, 4000));
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'EXIT_NONZERO', retryable: true });
      return;
    }
    ctx.deliver({ attemptId, claim: 'success', artifacts: this._collect(info, dir) });
  }

  // F2: a dependency's accepted output is handed over as a private, read-only copy of the bytes the gate verified (or, after a
  // resume when this process never held them, of the files re-read from the finished attempt and checked against the digest the
  // gate recorded). A process the dependency left running can still rewrite its own attempt directory, but nothing downstream reads it.
  _freezeDependencies(info, dir) {
    const dirs = {};
    for (const [dep, attempt] of Object.entries(info.depAttempts || {})) {
      const d = info.deps && info.deps[dep];
      if (!d) { dirs[dep] = this.attemptDir(info.runId, attempt); continue; } // a caller that does not describe its dependencies
      let artifacts = d.artifacts;
      if (!artifacts) {
        artifacts = {};
        for (const name of d.outputs) {
          const body = this._readOutput(this.attemptDir(info.runId, attempt), name);
          if (body === null) return { error: 'DEP_MISSING' };
          artifacts[name] = body;
        }
        if (digestArtifacts(artifacts) !== d.digest) return { error: 'DEP_CHANGED' };
      }
      const target = path.join(dir, 'deps', dep);
      fs.rmSync(target, { recursive: true, force: true }); // an attempt directory can be reused after a resume; its old copies are read-only
      fs.mkdirSync(target, { recursive: true });
      for (const [name, body] of Object.entries(artifacts)) {
        const file = path.join(target, name);
        fs.writeFileSync(file, body);
        fs.chmodSync(file, 0o444);
      }
      dirs[dep] = target;
    }
    return { dirs };
  }

  // Extension points for subclasses (see receipt-worker.js). The defaults add nothing.
  _prepare(_info, _dir) {}

  _onSpawn(_info, _dir, _pid) {}

  _onExit(_info, _dir, _result) {} // the process ended by itself: not killed, not timed out, not truncated

  // Declared outputs found in the attempt directory; one that is missing is simply absent, and the engine says why.
  _collect(info, dir) {
    const artifacts = {};
    for (const name of info.task.outputs) {
      const body = this._readOutput(dir, name);
      if (body !== null) artifacts[name] = body;
    }
    return artifacts;
  }

  _readOutput(dir, name) {
    const bytes = this._readOutputBytes(dir, name);
    return bytes === null ? null : bytes.toString('utf8');
  }

  _readOutputBytes(dir, name) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (_error) { return null; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) return null;
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) return null;
    return fs.readFileSync(real);
  }
}

module.exports = Object.freeze({ CommandWorker });
