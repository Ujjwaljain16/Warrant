'use strict';

const { assertRunSpec, specDigest } = require('../core/spec');
const { STATUS } = require('../core/states');
const { Scheduler } = require('../core/scheduler');
const { digestArtifacts, evaluateGate, isGateVerdict } = require('../core/gate');
const { MemoryRunLog } = require('../log/runlog');
const { realClock } = require('../util/clock');
const { redact } = require('../util/redact');
const { isPlainObject } = require('../core/ids');
const { declaredArtifacts, parseEnvelope } = require('./envelope');
const { buildRestore } = require('./replay');

const noop = () => {};

/**
 * Evidence-gated execution of a task DAG.
 *
 * Guarantees (see docs/ARCHITECTURE.md, I1-I8): a task becomes `succeeded` only through a GateVerdict;
 * a task is dispatched only when all its dependencies succeeded; attempts and concurrency are bounded;
 * each (task, attempt) result is ingested once; nothing starts after cancellation; non-repeatable effects
 * are never repeated on the strength of a guess; every state change is written to the run log before it
 * has an effect (write-ahead).
 */
class Engine {
  constructor(specInput, opts = {}) {
    this.spec = assertRunSpec(specInput);
    if (!opts.worker || typeof opts.worker.execute !== 'function') throw new TypeError('opts.worker.execute is required');
    this.worker = opts.worker;
    this.log = opts.log || new MemoryRunLog();
    this.clock = opts.clock || realClock;
    this.predicates = opts.predicates || {};
    this.workDirFor = opts.workDirFor || (() => undefined);
    this.gateCostMs = opts.gateCostMs || 0;
    this.backoffMs = opts.backoffMs || ((n) => 20 * n);
    this.observer = opts.observer || noop;
    this.signal = opts.signal;
    this.cap = Math.min(this.spec.max_concurrency, opts.concurrency ?? Infinity);
    this.restore = opts.restore || null;
    this.killGraceMs = opts.killGraceMs ?? 5000; // how long to wait for an aborted worker to actually stop
    this.workers = new Set();

    this.sched = new Scheduler(this.spec, this.restore ? this.restore.statuses : null);
    this.taskById = new Map(this.spec.tasks.map((t) => [t.id, t]));
    this.attemptsUsed = new Map(this.spec.tasks.map((t) => [t.id, this.restore ? (this.restore.attemptsUsed[t.id] || 0) : 0]));
    this.digests = new Map(this.restore ? Object.entries(this.restore.digests) : []);
    this.accepted = new Map(this.restore ? Object.entries(this.restore.accepted) : []); // task -> attempt whose output passed the gate
    this.records = new Map(this.spec.tasks.map((t) => [t.id, { code: null, verification: null, cancelled_in_flight: false }]));
    this.inflight = new Map();
    this.backoff = new Map();
    this.cancelled = false;
    this.finished = false;
    this.settled = false;
    this.started = false;
    this.duplicates = 0;
    this.totalAttempts = 0;
  }

  // ---------------------------------------------------------------- public API

  run() {
    if (this.started) throw new Error('engine can only run once');
    this.started = true;
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._start().catch((error) => this._fail(error));
    });
  }

  cancel(reason = 'CANCEL_REQUESTED') {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this._emit('cancel_requested', { data: { reason } });
    this.observer({ type: 'cancel', t: this.clock.now() });
    for (const handle of this.backoff.values()) this.clock.clearTimeout(handle);
    this.backoff.clear();
    const before = this.sched.snapshot();
    const inFlightIds = this.sched.cancelAll();
    for (const id of inFlightIds) {
      const att = this.inflight.get(id);
      if (att) this._kill(att);
      this.inflight.delete(id);
      const maybeApplied = this.taskById.get(id).effect !== 'pure';
      this.records.get(id).cancelled_in_flight = maybeApplied;
      this.records.get(id).code = 'CANCELLED_IN_FLIGHT';
      this._emit('task_settled', { task: id, data: { status: STATUS.CANCELLED, code: 'CANCELLED_IN_FLIGHT', effect_maybe_applied: maybeApplied } });
    }
    for (const [id, status] of Object.entries(before)) {
      if (status === STATUS.PENDING) {
        this.records.get(id).code = 'CANCELLED';
        this._emit('task_settled', { task: id, data: { status: STATUS.CANCELLED, code: 'CANCELLED' } });
      }
    }
    this._maybeFinish();
  }

  // ---------------------------------------------------------------- lifecycle

  async _start() {
    this._emit('run_started', { data: { spec_digest: specDigest(this.spec), resumed: Boolean(this.restore), tasks: this.spec.tasks.length } });
    if (this.signal) {
      if (this.signal.aborted) this.cancel('SIGNAL_ABORTED');
      else this.signal.addEventListener('abort', () => this._guard(() => this.cancel('SIGNAL_ABORTED')), { once: true });
    }
    if (this.restore && !this.cancelled) {
      // While lost attempts are being resolved, nothing else may be dispatched: they are still in the ready queue.
      this.recovering = true;
      try { await this._recoverLost(); } finally { this.recovering = false; }
    }
    this._pump();
  }

  _emit(type, fields = {}) {
    return this.log.append(type, fields, this.clock.now());
  }

  _guard(fn) {
    try { fn(); } catch (error) { this._fail(error); }
  }

  // Rejects the run exactly once. Distinct from `finished`: the run can be over (finished) while its promise is
  // still unsettled, e.g. when writing the final log entry fails.
  _fail(error) {
    if (this.settled) return;
    this.settled = true;
    this.finished = true;
    this.cancelled = true;
    for (const att of this.inflight.values()) this._kill(att);
    for (const handle of this.backoff.values()) this.clock.clearTimeout(handle);
    this._reject(error);
  }

  _kill(att) {
    att.dead = true;
    if (att.timer) this.clock.clearTimeout(att.timer);
    if (att.gateTimer) this.clock.clearTimeout(att.gateTimer);
    att.ctl.abort();
    if (att.rctl) att.rctl.abort();
    att.gctl.abort();
  }

  _pump() {
    if (this.cancelled || this.finished || this.recovering) return;
    while (this.inflight.size < this.cap && this.sched.readyCount() > 0) {
      const [id] = this.sched.takeReady(1);
      this._dispatch(id);
    }
    this._maybeFinish();
  }

  _maybeFinish() {
    if (this.finished) return;
    if (this.inflight.size === 0 && this.backoff.size === 0) {
      if (this.sched.allTerminal()) this._finish();
      else if (this.sched.readyCount() === 0) this._fail(new Error('scheduler stall: non-terminal tasks remain but none can run'));
    }
  }

  async _finish() {
    this.finished = true;
    try {
      // Predictable shutdown: do not report the run as finished while aborted workers may still be running.
      const live = [...this.workers].filter((a) => !a.workerSettled);
      const quiescent = await this._waitQuiescent(live);
      const report = this._buildReport();
      report.unquiesced_workers = quiescent ? 0 : live.filter((a) => !a.workerSettled).length;
      this._emit('run_finished', { data: { status: report.status, counts: report.counts } });
      report.log_head = this.log.head();
      report.log_entries = this.log.entries().length;
      this.settled = true;
      this._resolve(report);
    } catch (error) {
      this._fail(error);
    }
  }

  // ---------------------------------------------------------------- dispatch

  _dispatch(id) {
    const task = this.taskById.get(id);
    const no = this.attemptsUsed.get(id) + 1;
    if (no > task.max_attempts) throw new Error(`attempt budget exceeded for ${id}`);
    const depsOk = task.deps.every((d) => this.sched.statusOf(d) === STATUS.SUCCEEDED);
    this.sched.transition(id, STATUS.RUNNING);
    this.attemptsUsed.set(id, no);
    this.totalAttempts++;
    const att = this._newAttempt(task, no);
    const key = `${this.spec.run_id}:${id}`;
    // Write-ahead: the attempt is durable before the worker can have any effect.
    this._emit('attempt_started', { task: id, attempt: att.id, data: { no, key, effect: task.effect } });
    this.observer({ type: 'dispatch', t: this.clock.now(), task: id, attempt: no, deps_ok: depsOk, inflight: this.inflight.size + 1 });
    att.timer = this.clock.setTimeout(() => this._guard(() => this._onDeadline(att)), task.deadline_ms);
    this.inflight.set(id, att);
    const inputs = Object.fromEntries(task.deps.map((d) => [d, this.digests.get(d)]));
    const depAttempts = Object.fromEntries(task.deps.map((d) => [d, this.accepted.get(d)]));
    const info = { runId: this.spec.run_id, taskId: id, attemptNo: no, attemptId: att.id, idempotencyKey: key, inputs, depAttempts, task: { id, effect: task.effect, outputs: task.outputs, exec: task.exec, deadline_ms: task.deadline_ms } };
    let started;
    try {
      started = this.worker.execute(info, { signal: att.ctl.signal, deliver: (env) => this._guard(() => this._ingest(att, env)), clock: this.clock });
    } catch (error) {
      started = Promise.reject(error);
    }
    this._track(att, started);
  }

  // A worker's promise settling means its process/effect machinery has stopped. Tracking it lets the engine
  // avoid overlapping attempts of a non-repeatable task and avoid reporting 'finished' while workers still run.
  _track(att, started) {
    att.workerSettled = false;
    att.workerDone = Promise.resolve(started)
      .then(() => {}, (error) => { this._guard(() => this._onCrash(att, error)); })
      .then(() => { att.workerSettled = true; });
    this.workers.add(att);
  }

  async _waitQuiescent(attempts) {
    const pending = attempts.filter((a) => !a.workerSettled);
    if (pending.length === 0) return true;
    let timer;
    const timeout = new Promise((resolve) => { timer = this.clock.setTimeout(() => resolve(false), this.killGraceMs); });
    const stopped = Promise.all(pending.map((a) => a.workerDone)).then(() => true);
    const ok = await Promise.race([stopped, timeout]);
    this.clock.clearTimeout(timer);
    return ok;
  }

  _newAttempt(task, no) {
    return { id: `${task.id}.${no}`, task, taskId: task.id, no, ctl: new AbortController(), rctl: null, gctl: new AbortController(), timer: null, gateTimer: null, closed: false, dead: false };
  }

  _close(att) {
    att.closed = true;
    if (att.timer) { this.clock.clearTimeout(att.timer); att.timer = null; }
  }

  // ---------------------------------------------------------------- events from the worker side

  _onDeadline(att) {
    if (att.closed || att.dead) return;
    this._close(att);
    att.ctl.abort();
    this._lost(att, 'DEADLINE', true).catch((error) => this._fail(error));
  }

  _onCrash(att, error) {
    if (att.closed || att.dead) return; // crash after a result was accepted or after cancel: nothing to do
    this._close(att);
    this._lost(att, 'WORKER_CRASH', true, redact(error && error.message ? error.message : 'worker rejected')).catch((e) => this._fail(e));
  }

  _ingest(att, raw) {
    if (att.dead) return;
    if (att.closed) {
      // I6: a result for an attempt that already has one (or already timed out) never re-enters the machine.
      this.duplicates++;
      this._emit('duplicate_ignored', { task: att.taskId, attempt: att.id, data: { reason: att.delivered ? 'DUPLICATE_DELIVERY' : 'LATE_AFTER_CLOSE' } });
      this.observer({ type: 'duplicate', t: this.clock.now(), task: att.taskId });
      return;
    }
    const parsed = parseEnvelope(raw, att.id);
    if (parsed.ignore) {
      this._emit('duplicate_ignored', { task: att.taskId, attempt: att.id, data: { reason: parsed.code } });
      return;
    }
    this._close(att);
    att.delivered = true;
    if (!parsed.ok) {
      this._emit('attempt_result', { task: att.taskId, attempt: att.id, data: { claim: 'invalid', code: parsed.code } });
      this._lost(att, parsed.code, true).catch((e) => this._fail(e));
      return;
    }
    if (parsed.claim === 'failure') {
      this._emit('attempt_result', { task: att.taskId, attempt: att.id, data: { claim: 'failure', code: parsed.errorCode, retryable: parsed.retryable } });
      this._lost(att, parsed.errorCode, parsed.retryable).catch((e) => this._fail(e));
      return;
    }
    const artifacts = declaredArtifacts(att.task, parsed.artifacts);
    if (!att.task.outputs.every((name) => Object.hasOwn(artifacts, name))) {
      this._emit('attempt_result', { task: att.taskId, attempt: att.id, data: { claim: 'invalid', code: 'MISSING_OUTPUT' } });
      this._lost(att, 'MISSING_OUTPUT', true).catch((e) => this._fail(e));
      return;
    }
    this._emit('attempt_result', { task: att.taskId, attempt: att.id, data: { claim: 'success', digest: digestArtifacts(artifacts) } });
    this.sched.transition(att.taskId, STATUS.VERIFYING);
    this._verify(att, artifacts).catch((e) => this._fail(e));
  }

  // ---------------------------------------------------------------- verification and settlement

  async _verify(att, artifacts) {
    const task = att.task;
    if (this.gateCostMs > 0 && task.requirements.length > 0) {
      await new Promise((resolve) => { att.gateTimer = this.clock.setTimeout(resolve, this.gateCostMs * task.requirements.length); });
      if (att.dead) return;
    }
    const verdict = await evaluateGate({
      task, attemptId: att.id, artifacts,
      ctx: { predicates: this.predicates, workDir: this.workDirFor({ runId: this.spec.run_id, attemptId: att.id, taskId: att.taskId }), signal: att.gctl.signal },
    });
    if (att.dead) return;
    this._emit('gate_verdict', {
      task: task.id, attempt: att.id,
      data: { status: verdict.status, digest: verdict.artifacts_digest, passed: [...verdict.passed], failed: [...verdict.failed], not_verified: [...verdict.not_verified], claim_only: verdict.claim_only },
    });
    this.records.get(task.id).verification = {
      level: verdict.claim_only ? 'claim_only' : 'gated',
      passed: [...verdict.passed], failed: [...verdict.failed], not_verified: [...verdict.not_verified],
    };
    if (verdict.status === 'pass') return this._settleSucceeded(att, verdict);
    if (verdict.status === 'fail') {
      // The effect (if any) has already happened and produced wrong output; repeating it is only safe for repeatable classes.
      if (task.effect === 'external-nonrepeatable') return this._settle(att, STATUS.FAILED, 'GATE_FAILED');
      return this._retryOrFail(att, 'GATE_FAILED');
    }
    return this._settle(att, STATUS.UNKNOWN, 'UNVERIFIED');
  }

  _settleSucceeded(att, verdict) {
    // Defence in depth for I1: the only way to reach `succeeded` is a minted, passing verdict for THIS attempt.
    if (!isGateVerdict(verdict) || verdict.status !== 'pass' || verdict.attempt_id !== att.id || verdict.task_id !== att.taskId) {
      throw new Error(`refusing to mark ${att.taskId} succeeded without a passing gate verdict`);
    }
    this.sched.transition(att.taskId, STATUS.SUCCEEDED);
    this.digests.set(att.taskId, verdict.artifacts_digest);
    this.accepted.set(att.taskId, att.id);
    this.records.get(att.taskId).code = verdict.claim_only ? 'CLAIM_ONLY' : 'VERIFIED';
    this._emit('task_settled', { task: att.taskId, attempt: att.id, data: { status: STATUS.SUCCEEDED, code: this.records.get(att.taskId).code, digest: verdict.artifacts_digest } });
    this.inflight.delete(att.taskId);
    this.observer({ type: 'settled', t: this.clock.now(), task: att.taskId, status: STATUS.SUCCEEDED });
    this._pump();
  }

  _settle(att, status, code) {
    if (status === STATUS.SUCCEEDED) throw new Error('use _settleSucceeded: success requires a gate verdict');
    this.sched.transition(att.taskId, status);
    this.records.get(att.taskId).code = code;
    const data = { status, code };
    const verification = this.records.get(att.taskId).verification;
    if (verification && verification.not_verified.length) data.not_verified = verification.not_verified;
    this._emit('task_settled', { task: att.taskId, attempt: att.id, data });
    this.inflight.delete(att.taskId);
    this.observer({ type: 'settled', t: this.clock.now(), task: att.taskId, status });
    this._pump();
  }

  _retryOrFail(att, code) {
    const task = att.task;
    if (att.no < task.max_attempts && !this.cancelled) {
      const delay = this.backoffMs(att.no);
      this._emit('attempt_failed', { task: task.id, attempt: att.id, data: { code, retry: true, backoff_ms: delay } });
      this.sched.transition(task.id, STATUS.PENDING);
      this.inflight.delete(task.id);
      const handle = this.clock.setTimeout(() => this._guard(() => {
        this.backoff.delete(task.id);
        if (this.cancelled) return;
        this.sched.release(task.id);
        this._pump();
      }), delay);
      this.backoff.set(task.id, handle);
      this._pump();
      return;
    }
    this._emit('attempt_failed', { task: task.id, attempt: att.id, data: { code, retry: false } });
    this._settle(att, STATUS.FAILED, code === 'GATE_FAILED' ? 'GATE_FAILED' : 'ATTEMPTS_EXHAUSTED');
  }

  // An attempt produced no usable result (crash, deadline, failure claim, invalid envelope, restart).
  async _lost(att, code, retryable, detail) {
    if (att.dead) return;
    const task = att.task;
    if (!retryable) {
      this._emit('attempt_failed', { task: task.id, attempt: att.id, data: { code, retry: false } });
      return this._settle(att, STATUS.FAILED, code);
    }
    if (task.effect !== 'external-nonrepeatable') return this._retryOrFail(att, code);
    // The effect may or may not have happened, and repeating it may be harmful: ask the worker's side, do not guess.
    // First make sure the old attempt can no longer act, otherwise a retry could overlap with a late effect.
    if (att.workerDone && !(await this._waitQuiescent([att]))) {
      if (att.dead) return;
      this._emit('attempt_ambiguous', { task: task.id, attempt: att.id, data: { code: 'WORKER_NOT_QUIESCENT' } });
      this.records.get(task.id).verification = { level: 'none', passed: [], failed: [], not_verified: task.requirements.map((r) => r.id) };
      return this._settle(att, STATUS.UNKNOWN, 'WORKER_NOT_QUIESCENT');
    }
    if (att.dead) return;
    const data = { code };
    if (detail) data.detail = detail;
    this._emit('attempt_ambiguous', { task: task.id, attempt: att.id, data });
    const resolution = await this._reconcile(att);
    if (att.dead) return;
    if (resolution.outcome === 'not_applied') return this._retryOrFail(att, code);
    if (resolution.outcome === 'applied' && resolution.artifacts) {
      if (this.sched.statusOf(task.id) === STATUS.RUNNING) this.sched.transition(task.id, STATUS.VERIFYING);
      return this._verify(att, declaredArtifacts(task, resolution.artifacts));
    }
    this.records.get(task.id).verification = { level: 'none', passed: [], failed: [], not_verified: task.requirements.map((r) => r.id) };
    return this._settle(att, STATUS.UNKNOWN, resolution.outcome === 'applied' ? 'APPLIED_UNVERIFIABLE' : 'AMBIGUOUS_EFFECT');
  }

  async _reconcile(att) {
    const task = att.task;
    let outcome = 'unavailable';
    let artifacts = null;
    if (typeof this.worker.reconcile === 'function') {
      att.rctl = new AbortController();
      let timer;
      const timeout = new Promise((resolve) => { timer = this.clock.setTimeout(() => resolve('timeout'), task.deadline_ms); });
      try {
        const raw = await Promise.race([
          this.worker.reconcile({ runId: this.spec.run_id, taskId: task.id, attemptId: att.id, idempotencyKey: `${this.spec.run_id}:${task.id}`, task: { id: task.id, effect: task.effect, outputs: task.outputs } }, { signal: att.rctl.signal, clock: this.clock }),
          timeout,
        ]);
        outcome = 'inconclusive';
        if (isPlainObject(raw) && raw.applied === false) outcome = 'not_applied';
        else if (isPlainObject(raw) && raw.applied === true) {
          outcome = 'applied';
          if (raw.artifacts !== undefined) {
            const parsed = parseEnvelope({ attemptId: att.id, claim: 'success', artifacts: raw.artifacts }, att.id);
            if (parsed.ok) artifacts = parsed.artifacts;
          }
        }
      } catch (_error) {
        outcome = 'inconclusive';
      } finally {
        this.clock.clearTimeout(timer);
      }
    }
    this._emit('reconcile', { task: task.id, attempt: att.id, data: { outcome } });
    return { outcome, artifacts };
  }

  // ---------------------------------------------------------------- resume

  async _recoverLost() {
    for (const lost of this.restore.lost) {
      if (this.cancelled) return;
      const task = this.taskById.get(lost.taskId);
      this.sched.transition(task.id, STATUS.RUNNING);
      const att = this._newAttempt(task, lost.attemptNo);
      att.id = lost.attemptId;
      att.closed = true;
      this.inflight.set(task.id, att);
      await this._lost(att, 'ORCHESTRATOR_RESTART', true);
    }
  }

  // ---------------------------------------------------------------- report

  _buildReport() {
    const tasks = {};
    for (const task of this.spec.tasks) {
      const status = this.sched.statusOf(task.id);
      const rec = this.records.get(task.id);
      tasks[task.id] = {
        status,
        attempts: this.attemptsUsed.get(task.id),
        code: rec.code || (status === STATUS.BLOCKED ? 'DEPENDENCY_NOT_SUCCEEDED' : null),
        verification: rec.verification,
        artifacts_digest: status === STATUS.SUCCEEDED ? this.digests.get(task.id) : null,
        cancelled_in_flight: rec.cancelled_in_flight,
      };
    }
    const counts = { ...this.sched.counts };
    let status = 'succeeded';
    if (this.cancelled) status = 'cancelled';
    else if (counts.failed) status = 'failed';
    else if (counts.unknown) status = 'unknown';
    else if (counts.blocked) status = 'blocked';
    return { run_id: this.spec.run_id, spec_digest: specDigest(this.spec), status, counts, tasks, attempts: this.totalAttempts, duplicates_ignored: this.duplicates };
  }
}

function runGated(spec, opts) {
  return new Engine(spec, opts).run();
}

// Continue an interrupted run from its log. The log must be open for writing (a FileRunLog) and valid.
// An empty log means the previous process died before recording anything, so nothing has happened: start fresh.
function resumeGated(spec, opts) {
  const entries = opts.log.entries();
  if (entries.length === 0) return new Engine(spec, opts).run();
  const restore = buildRestore(assertRunSpec(spec), entries);
  return new Engine(spec, { ...opts, restore }).run();
}

module.exports = Object.freeze({ Engine, resumeGated, runGated });
