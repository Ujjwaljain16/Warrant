'use strict';

const STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
  CANCELLED: 'cancelled',
});

const TERMINAL = Object.freeze([STATUS.SUCCEEDED, STATUS.FAILED, STATUS.BLOCKED, STATUS.UNKNOWN, STATUS.CANCELLED]);

// `unknown` is terminal for a run, but a reconcile resolution may move it on. That resolution is
// performed by the engine before the task settles (or on resume, before the scheduler is rebuilt),
// so the live scheduler never leaves `unknown`.
const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['running', 'blocked', 'cancelled']),
  running: Object.freeze(['verifying', 'pending', 'failed', 'unknown', 'cancelled']),
  verifying: Object.freeze(['succeeded', 'pending', 'failed', 'unknown', 'cancelled']),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  blocked: Object.freeze([]),
  unknown: Object.freeze([]),
  cancelled: Object.freeze([]),
});

class InvalidTransitionError extends Error {
  constructor(taskId, from, to) {
    super(`invalid transition for task ${taskId}: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.code = 'INVALID_TRANSITION';
    this.taskId = taskId;
    this.from = from;
    this.to = to;
  }
}

function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

function assertTransition(taskId, from, to) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(taskId, from, to);
}

module.exports = Object.freeze({
  InvalidTransitionError, STATUS, TERMINAL, TRANSITIONS,
  assertTransition, canTransition,
});
