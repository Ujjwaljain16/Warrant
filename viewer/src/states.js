'use strict';

// Mirror of src/core/states.js and the event list of src/log/runlog.js. The viewer is a standalone file, so
// these are copied rather than required; test/viewer.test.js fails if they ever drift from the engine.

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

const TERMINAL = Object.freeze(['succeeded', 'failed', 'blocked', 'unknown', 'cancelled']);

const EVENT_TYPES = Object.freeze([
  'run_started', 'attempt_started', 'attempt_result', 'attempt_ambiguous', 'attempt_failed',
  'gate_verdict', 'reconcile', 'task_settled', 'duplicate_ignored', 'cancel_requested', 'run_finished',
]);

function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

module.exports = { EVENT_TYPES, STATUS, TERMINAL, TRANSITIONS, canTransition };
