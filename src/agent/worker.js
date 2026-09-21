'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_ARTIFACT_BYTES } = require('../engine/envelope');
const { redactSecrets } = require('../llm/secrets');
const { runInSandbox } = require('../sandbox/docker');
const { runAgent } = require('./loop');
const { Workspace } = require('./workspace');

// outcome of the agent loop -> how the attempt is reported to the engine
const FAILURE_CODES = Object.freeze({
  max_steps: { errorCode: 'MAX_STEPS', retryable: false },
  protocol_errors: { errorCode: 'PROTOCOL_ERROR', retryable: false },
  llm_error: { errorCode: 'LLM_ERROR', retryable: true },
  quota_exhausted: { errorCode: 'QUOTA_EXHAUSTED', retryable: false },
});

/**
 * Worker that runs a model-driven agent on a copy of a task's starting repo (Worker contract: docs/ARCHITECTURE.md).
 *
 *  - the attempt directory holds `workspace/` (the agent's copy of repo/), `transcript.jsonl` and `agent-result.json`;
 *  - the agent's claim is mapped onto the envelope: "done" -> claim:'success' with the declared output files as artifacts;
 *    "cannot", running out of steps, malformed output, or model errors -> claim:'failure' with a stable error code;
 *  - a success claim is only an input to the engine's gate; the hidden tests decide whether the task succeeded;
 *  - run_tests executes in the Docker sandbox; no model-written code runs on the host.
 *
 * `tasks` maps the warrant task id to a loaded agent task (see agent/task.js). `results` keeps each attempt's summary
 * (claim, outcome, usage) so a benchmark can compare what the agent said with what the gate decided.
 */
class AgentWorker {
  constructor({ baseDir, llm, model, tasks, sandbox = runInSandbox, loop = {}, testTimeoutMs = 60_000 }) {
    if (typeof baseDir !== 'string' || !baseDir) throw new TypeError('baseDir is required');
    if (!llm || typeof llm.generate !== 'function') throw new TypeError('llm must be an LlmClient');
    this.baseDir = path.resolve(baseDir);
    this.llm = llm;
    this.model = model;
    this.tasks = tasks instanceof Map ? tasks : new Map(Object.entries(tasks));
    this.sandbox = sandbox;
    this.loop = loop;
    this.testTimeoutMs = testTimeoutMs;
    this.results = new Map();
  }

  attemptDir(runId, attemptId) {
    const dir = path.resolve(this.baseDir, runId, attemptId);
    if (!dir.startsWith(this.baseDir + path.sep)) throw new Error('attempt directory escapes the base directory');
    return dir;
  }

  // The directory command verifiers run in: the attempt directory (the gate reads ./workspace from it).
  workDirFor({ runId, attemptId }) {
    return this.attemptDir(runId, attemptId);
  }

  async execute(info, ctx) {
    const { attemptId, taskId } = info;
    const task = this.tasks.get(taskId);
    if (!task) {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'UNKNOWN_TASK', retryable: false });
      return;
    }
    const dir = this.attemptDir(info.runId, attemptId);
    const wsDir = path.join(dir, 'workspace');
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(task.repoDir, wsDir, { recursive: true, dereference: false });
    const workspace = new Workspace(wsDir);

    const run = await runAgent({
      llm: this.llm, model: this.model, prompt: task.prompt, workspace, signal: ctx.signal, ...this.loop,
      runTests: (signal) => this.sandbox({ workspace: wsDir, argv: task.meta.visible_test_argv, timeoutMs: this.testTimeoutMs, signal, mode: 'copy' }),
    });

    const summary = { task: taskId, attempt: attemptId, model: this.model, outcome: run.outcome, claim: run.claim, note: run.note, steps: run.steps, usage: run.usage, protocolErrors: run.protocolErrors };
    if (run.error) summary.error = run.error;
    this.results.set(attemptId, summary);
    this._writeRecords(dir, run, summary);
    if (run.outcome === 'aborted') return; // the engine cancelled or timed the attempt out: say nothing

    if (run.outcome === 'finished' && run.claim === 'done') {
      ctx.deliver({ attemptId, claim: 'success', artifacts: this._collect(task, wsDir) });
    } else if (run.outcome === 'finished') {
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'AGENT_CANNOT', retryable: false });
    } else {
      const code = FAILURE_CODES[run.outcome];
      ctx.deliver({ attemptId, claim: 'failure', errorCode: code.errorCode, retryable: code.retryable });
    }
  }

  // The declared outputs exactly as the agent left them; an unreadable or oversized one is simply absent (the engine says why).
  _collect(task, wsDir) {
    const artifacts = {};
    for (const name of task.meta.outputs) {
      const file = path.join(wsDir, name);
      let stat;
      try { stat = fs.lstatSync(file); } catch (_error) { continue; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) continue;
      artifacts[name] = fs.readFileSync(file, 'utf8');
    }
    return artifacts;
  }

  _writeRecords(dir, run, summary) {
    const lines = run.transcript.map((entry) => redactSecrets(JSON.stringify(entry), [], 200_000));
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), `${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'agent-result.json'), JSON.stringify(summary));
  }
}

module.exports = Object.freeze({ AgentWorker, FAILURE_CODES });
