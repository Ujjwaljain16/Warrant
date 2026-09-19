'use strict';

const { specDigest } = require('../core/spec');
const { verifyEntries } = require('../log/runlog');
const { STATUS } = require('../core/states');
const { auditCore } = require('./audit-core');

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
 * that wrote it. Returns a list of violations (empty means the log is consistent with I1-I8 and with the rules in audit-core.js).
 * spec may be null (log only: the checks that need the task graph are skipped).
 */
function auditLog(spec, entries) {
  try { verifyEntries(entries); } catch (error) { return [{ code: 'I8_CHAIN', seq: null, message: error.message }]; }
  return auditCore({ spec, entries, expectedDigest: spec ? specDigest(spec) : null });
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
