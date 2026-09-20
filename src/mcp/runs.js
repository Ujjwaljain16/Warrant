'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Engine } = require('../engine/engine');
const { auditLog, replayLog } = require('../engine/replay');
const { FileRunLog, LogCorruptionError, readRunLogFile } = require('../log/runlog');
const { assertRunSpec } = require('../core/spec');
const { ReceiptWorker } = require('../workers/receipt-worker');
const { ToolError } = require('./jsonrpc');
const { LIMITS, cleanDeep, cleanText } = require('./limits');

const RUN_ID = /^mcp-[0-9a-f]{12}$/;

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  fs.renameSync(tmp, file);
}

// Reads a file this server wrote into the state directory, refusing symlinks, non-files and oversized files.
function readStateJson(file, what) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (_error) { return null; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.maxStateFileBytes) throw new ToolError('STATE_CORRUPT', `${what} is not a regular file within the size limit`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { throw new ToolError('STATE_CORRUPT', `${what} is not valid JSON`); }
}

/**
 * Runs approved specs, one at a time, and answers questions about past runs from the files under <stateDir>/runs/<run_id>/:
 *   meta.json   what was asked and how it ended      spec.json   the exact spec that ran (server-chosen run id)
 *   run.log     the hash-chained run log             report.json the engine's final report
 *   attempts/   per-attempt working directories of the commands
 * Everything the model supplies (a spec name, a run id, a concurrency) is validated before it touches a path or the engine.
 */
class RunManager {
  constructor({ specs, stateDir, maxRunMs = LIMITS.defaultMaxRunMs, syncWaitMs = LIMITS.defaultSyncWaitMs, killGraceMs = LIMITS.killGraceMs, now = () => new Date(), log = () => {} }) {
    this.specs = specs;
    this.log = log; // the operator's channel (stderr); host paths and system error text go here, never to the model
    fs.mkdirSync(stateDir, { recursive: true });
    this.stateDir = fs.realpathSync(stateDir);
    this.runsDir = path.join(this.stateDir, 'runs');
    fs.mkdirSync(this.runsDir, { recursive: true });
    this.maxRunMs = maxRunMs;
    this.syncWaitMs = syncWaitMs;
    this.killGraceMs = killGraceMs;
    this.now = now;
    this.active = null;
  }

  static isRunId(value) {
    return typeof value === 'string' && RUN_ID.test(value);
  }

  _runDir(runId) {
    if (!RunManager.isRunId(runId)) throw new ToolError('INVALID_RUN_ID', 'run_id must look like mcp-0123456789ab (as returned by warrant_run)');
    const dir = path.join(this.runsDir, runId);
    let stat;
    try { stat = fs.lstatSync(dir); } catch (_error) { throw new ToolError('RUN_NOT_FOUND', `no run with id ${runId}`); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ToolError('RUN_NOT_FOUND', `no run with id ${runId}`);
    return dir;
  }

  // ------------------------------------------------------------------ starting a run

  // Starts a run and returns its handle synchronously: the one-at-a-time check and the claim of the slot happen with
  // no await in between, so two requests can never both pass it.
  start(name, requestedConcurrency) {
    if (this.active) {
      throw new ToolError('RUN_IN_PROGRESS', `run ${this.active.runId} is still in progress (this server runs one at a time); poll warrant_status with that run_id`);
    }
    const runId = `mcp-${crypto.randomBytes(6).toString('hex')}`;
    const loaded = this.specs.load(name, runId);
    const spec = loaded.spec;
    const concurrency = requestedConcurrency === undefined ? spec.max_concurrency : Math.min(requestedConcurrency, spec.max_concurrency);

    const runDir = path.join(this.runsDir, runId);
    const startedAt = this.now().toISOString();
    const meta = {
      run_id: runId, spec_name: name, spec_file_sha256: loaded.digest, state: 'running', started_at: startedAt, finished_at: null,
      requested_concurrency: requestedConcurrency === undefined ? null : requestedConcurrency, effective_concurrency: concurrency,
      wall_clock_cap_ms: this.maxRunMs, termination: null, status: null,
    };
    const controller = new AbortController();
    let log;
    let engine;
    try {
      fs.mkdirSync(runDir);
      writeJsonAtomic(path.join(runDir, 'spec.json'), spec);
      writeJsonAtomic(path.join(runDir, 'meta.json'), meta);
      log = new FileRunLog(path.join(runDir, 'run.log'));
      const worker = new ReceiptWorker({ baseDir: path.join(runDir, 'attempts'), specDir: loaded.dir });
      engine = new Engine(spec, { worker, log, workDirFor: (a) => worker.workDirFor(a), concurrency, signal: controller.signal, killGraceMs: this.killGraceMs });
    } catch (error) {
      if (log) log.close();
      try { writeJsonAtomic(path.join(runDir, 'meta.json'), { ...meta, state: 'error', termination: 'error', error: cleanText(error.message, 300) }); } catch (_ignored) { /* nothing more to record */ }
      this.log(`could not start run ${runId}: ${error && error.message}`);
      throw new ToolError('RUN_START_FAILED', 'could not start the run: the server could not prepare its run directory (details are in the server log)');
    }
    const active = { runId, name, startedAt, controller, capped: false, cancelledByClient: false, done: null, meta, runDir };
    this.active = active;
    const timer = setTimeout(() => { active.capped = true; controller.abort(); }, this.maxRunMs);
    active.done = engine.run().then(
      (report) => this._finish(active, log, timer, report, null),
      (error) => this._finish(active, log, timer, null, error),
    );
    return active;
  }

  // Waits for the run for at most syncWaitMs. Resolves with the finished outcome, or null if it is still running.
  async waitFor(active, ms = this.syncWaitMs) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
    const outcome = await Promise.race([active.done, timeout]);
    clearTimeout(timer);
    return outcome;
  }

  cancelActive(runId) {
    if (this.active && this.active.runId === runId) { this.active.cancelledByClient = true; this.active.controller.abort(); }
  }

  _finish(active, log, timer, report, error) {
    clearTimeout(timer);
    try { log.close(); } catch (_error) { /* the report below is what matters */ }
    const termination = active.capped ? 'wall_clock_cap' : active.cancelledByClient ? 'cancelled_by_client' : error ? 'error' : 'completed';
    const meta = { ...active.meta, state: error ? 'error' : 'finished', finished_at: this.now().toISOString(), termination, status: report ? report.status : null };
    if (error) meta.error = cleanText(error && error.message ? error.message : 'run failed', 300);
    let outcome = { run_id: active.runId, spec: active.name, termination, effective_concurrency: meta.effective_concurrency, error: meta.error || null, report };
    try {
      if (report) writeJsonAtomic(path.join(active.runDir, 'report.json'), { ...report, termination });
      writeJsonAtomic(path.join(active.runDir, 'meta.json'), meta);
    } catch (writeError) {
      outcome = { ...outcome, error: cleanText(`could not persist the run result: ${writeError.message}`, 300) };
    }
    if (this.active === active) this.active = null;
    return outcome;
  }

  // Stops the active run (if any) and waits for its processes to be gone. Used when the client disconnects.
  async shutdown() {
    if (!this.active) return;
    const { done, controller } = this.active;
    controller.abort();
    await done;
  }

  // ------------------------------------------------------------------ questions about runs

  status(runId) {
    const dir = this._runDir(runId);
    const meta = readStateJson(path.join(dir, 'meta.json'), 'run metadata');
    const spec = readStateJson(path.join(dir, 'spec.json'), 'run spec');
    if (!meta || !spec) throw new ToolError('STATE_CORRUPT', `run ${runId} has no metadata`);
    const live = Boolean(this.active && this.active.runId === runId);
    // A run recorded as running whose process is not this one was cut off by a server restart.
    const state = live ? 'running' : meta.state === 'running' ? 'interrupted' : meta.state;
    const { entries, head, torn, error } = this._readLog(dir);
    const replay = error ? null : replayLog(entries);
    const tasks = {};
    for (const t of spec.tasks) {
      const r = replay && replay.tasks.get(t.id);
      tasks[t.id] = { status: r ? r.status : 'pending', attempts: r ? r.attempts : 0, code: r ? r.code : null };
    }
    return {
      run_id: runId, spec: cleanText(meta.spec_name, 64), state, run_status: replay && replay.finished ? replay.runStatus : null,
      termination: meta.termination, started_at: meta.started_at, finished_at: meta.finished_at,
      effective_concurrency: meta.effective_concurrency, wall_clock_cap_ms: meta.wall_clock_cap_ms,
      tasks, log_entries: entries.length, log_head: head, torn_tail: torn,
      log_error: error, // data about the log, not an instruction
      recent_events: entries.slice(-LIMITS.maxRecentEvents).map((e) => ({ seq: e.seq, type: e.type, task: e.task || null, attempt: e.attempt || null, data: cleanDeep(e.data) })),
    };
  }

  verifyLog(runId) {
    const dir = this._runDir(runId);
    const specRecord = readStateJson(path.join(dir, 'spec.json'), 'run spec');
    if (!specRecord) throw new ToolError('STATE_CORRUPT', `run ${runId} has no spec copy`);
    const spec = assertRunSpec(specRecord);
    const { entries, head, torn, error } = this._readLog(dir);
    const live = Boolean(this.active && this.active.runId === runId);
    if (error) return { run_id: runId, ok: false, chain_ok: false, entries: 0, head: null, torn_tail: false, invariants_checked: false, violations: [], violations_total: 0, log_error: error, run_active: live };
    const violations = auditLog(spec, entries);
    return {
      run_id: runId, ok: violations.length === 0, chain_ok: true, entries: entries.length, head, torn_tail: torn, invariants_checked: true,
      violations: violations.slice(0, LIMITS.maxViolations).map((v) => ({ code: v.code, seq: v.seq, message: cleanText(v.message, 300) })),
      violations_total: violations.length, log_error: null, run_active: live,
    };
  }

  report(runId) {
    const dir = this._runDir(runId);
    if (this.active && this.active.runId === runId) throw new ToolError('RUN_IN_PROGRESS', `run ${runId} is still running; poll warrant_status`);
    const meta = readStateJson(path.join(dir, 'meta.json'), 'run metadata');
    const report = readStateJson(path.join(dir, 'report.json'), 'run report');
    if (!report) throw new ToolError('NO_REPORT', `run ${runId} has no final report (state: ${meta ? meta.state : 'unknown'}); it did not finish, see warrant_status`);
    return { spec: meta ? cleanText(meta.spec_name, 64) : null, ...cleanDeep(report) };
  }

  _readLog(dir) {
    const file = path.join(dir, 'run.log');
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return { entries: [], head: null, torn: false, error: { code: 'LOG_NOT_A_FILE', message: 'run.log is not a regular file' } };
      if (stat.size > LIMITS.maxLogBytes) return { entries: [], head: null, torn: false, error: { code: 'LOG_TOO_LARGE', message: `run.log exceeds ${LIMITS.maxLogBytes} bytes` } };
      const loaded = readRunLogFile(file);
      return { entries: loaded.entries, head: loaded.head, torn: loaded.torn, error: null };
    } catch (error) {
      if (error instanceof LogCorruptionError) return { entries: [], head: null, torn: false, error: { code: error.code, message: cleanText(error.message, 300) } };
      if (error && error.code === 'ENOENT') return { entries: [], head: null, torn: false, error: null };
      throw error;
    }
  }
}

module.exports = Object.freeze({ RunManager });
