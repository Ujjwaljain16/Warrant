'use strict';

const { specDigest } = require('../core/spec');
const { verifyEntries } = require('../log/runlog');
const { STATUS } = require('../core/states');

class ResumeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResumeError';
    this.code = code;
  }
}

/**
 * Fold a log into per-task state. Pure: depends only on the entries.
 * `open` is the attempt that has been started but not yet resolved by a retry or a settlement.
 */
function replayLog(entries) {
  const tasks = new Map();
  const get = (id) => {
    if (!tasks.has(id)) tasks.set(id, { status: STATUS.PENDING, attempts: 0, open: null, digest: null, code: null, attempt: null });
    return tasks.get(id);
  };
  const state = { tasks, specDigest: null, cancelled: false, finished: false, runStatus: null, duplicates: 0, starts: 0 };
  for (const e of entries) {
    switch (e.type) {
      case 'run_started':
        if (state.specDigest === null) state.specDigest = e.data.spec_digest;
        break;
      case 'attempt_started': {
        const t = get(e.task);
        t.attempts = Math.max(t.attempts, e.data.no);
        t.open = { attemptId: e.attempt, no: e.data.no };
        state.starts++;
        break;
      }
      case 'attempt_failed':
        if (e.data.retry) get(e.task).open = null;
        break;
      case 'task_settled': {
        const t = get(e.task);
        t.status = e.data.status;
        t.code = e.data.code;
        t.open = null;
        t.digest = e.data.digest || null;
        t.attempt = e.attempt || null;
        break;
      }
      case 'duplicate_ignored':
        state.duplicates++;
        break;
      case 'cancel_requested':
        state.cancelled = true;
        break;
      case 'run_finished':
        state.finished = true;
        state.runStatus = e.data.status;
        break;
      default:
        break;
    }
  }
  return state;
}

/**
 * Check the structural invariants of docs/ARCHITECTURE.md against a log, independently of the engine
 * that wrote it. Returns a list of violations (empty means the log is consistent with I1-I8).
 */
function auditLog(spec, entries) {
  const violations = [];
  const flag = (code, entry, message) => violations.push({ code, seq: entry ? entry.seq : null, message });
  try { verifyEntries(entries); } catch (error) { flag('I8_CHAIN', null, error.message); return violations; }

  const taskById = new Map(spec.tasks.map((t) => [t.id, t]));
  const succeeded = new Set();
  const terminal = new Set();
  const verdicts = new Map();       // attempt id -> { status, digest }
  const resultsSeen = new Set();    // attempt ids with an attempt_result
  const startsByTask = new Map();
  const reconciledNotApplied = new Map(); // task -> attempt id whose reconcile said not_applied
  const inFlight = new Set();
  let cancelled = false;
  const cap = spec.max_concurrency;

  for (const e of entries) {
    const task = e.task ? taskById.get(e.task) : null;
    switch (e.type) {
      case 'attempt_started': {
        if (!task) { flag('UNKNOWN_TASK', e, `attempt for unknown task ${e.task}`); break; }
        if (cancelled) flag('I7_START_AFTER_CANCEL', e, `${e.task} started after cancellation`);
        if (terminal.has(e.task)) flag('I4_START_AFTER_TERMINAL', e, `${e.task} started after settling`);
        for (const dep of task.deps) if (!succeeded.has(dep)) flag('I2_DEP_NOT_SUCCEEDED', e, `${e.task} started before ${dep} succeeded`);
        const n = (startsByTask.get(e.task) || 0) + 1;
        startsByTask.set(e.task, n);
        if (e.data.no !== n) flag('ATTEMPT_NUMBERING', e, `${e.task} attempt number ${e.data.no}, expected ${n}`);
        if (n > task.max_attempts) flag('I3_ATTEMPT_BUDGET', e, `${e.task} exceeded ${task.max_attempts} attempts`);
        if (task.effect === 'external-nonrepeatable' && n > 1 && reconciledNotApplied.get(e.task) !== `${e.task}.${n - 1}`) {
          flag('I5_NONREPEATABLE_RESTART', e, `${e.task} restarted without evidence that attempt ${n - 1} did not apply`);
        }
        inFlight.add(e.task);
        if (inFlight.size > cap) flag('I3_CONCURRENCY', e, `${inFlight.size} attempts in flight, cap is ${cap}`);
        break;
      }
      case 'attempt_result':
        if (resultsSeen.has(e.attempt)) flag('I6_DOUBLE_INGEST', e, `attempt ${e.attempt} ingested twice`);
        resultsSeen.add(e.attempt);
        break;
      case 'gate_verdict':
        verdicts.set(e.attempt, { status: e.data.status, digest: e.data.digest });
        break;
      case 'reconcile':
        if (e.data.outcome === 'not_applied') reconciledNotApplied.set(e.task, e.attempt);
        break;
      case 'attempt_failed':
        if (e.data.retry) inFlight.delete(e.task);
        break;
      case 'task_settled': {
        if (terminal.has(e.task)) flag('I4_TERMINAL_CHANGED', e, `${e.task} settled twice`);
        if (e.data.status === STATUS.SUCCEEDED) {
          const v = verdicts.get(e.attempt);
          if (!v || v.status !== 'pass' || v.digest !== e.data.digest) flag('I1_UNVERIFIED_SUCCESS', e, `${e.task} succeeded without a matching passing verdict`);
          succeeded.add(e.task);
        }
        terminal.add(e.task);
        inFlight.delete(e.task);
        break;
      }
      case 'cancel_requested':
        cancelled = true;
        break;
      default:
        break;
    }
  }
  return violations;
}

/**
 * Prepare an Engine `restore` from a log. Tasks with an attempt that was started but never resolved are
 * "lost": their outcome is unknown and the engine decides what to do by effect class on resume.
 */
function buildRestore(spec, entries) {
  verifyEntries(entries);
  const state = replayLog(entries);
  if (state.specDigest !== specDigest(spec)) throw new ResumeError('SPEC_MISMATCH', 'the spec does not match the one this log was written for');
  if (state.finished) throw new ResumeError('RUN_FINISHED', `this run already finished with status ${state.runStatus}`);
  if (state.cancelled) throw new ResumeError('RUN_CANCELLED', 'this run was cancelled');
  const violations = auditLog(spec, entries);
  if (violations.length) throw new ResumeError('LOG_INCONSISTENT', `log violates ${violations[0].code}: ${violations[0].message}`);
  const statuses = {};
  const attemptsUsed = {};
  const digests = {};
  const accepted = {};
  const lost = [];
  for (const task of spec.tasks) {
    const t = state.tasks.get(task.id);
    if (!t) continue;
    attemptsUsed[task.id] = t.attempts;
    if (t.status !== STATUS.PENDING) statuses[task.id] = t.status;
    if (t.status === STATUS.SUCCEEDED) { digests[task.id] = t.digest; accepted[task.id] = t.attempt; }
    if (t.status === STATUS.PENDING && t.open) lost.push({ taskId: task.id, attemptNo: t.open.no, attemptId: t.open.attemptId });
  }
  return { statuses, attemptsUsed, digests, accepted, lost };
}

module.exports = Object.freeze({ ResumeError, auditLog, buildRestore, replayLog });
