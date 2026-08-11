'use strict';

const { unit } = require('./rng');

// Per-attempt fate probabilities by profile. These numbers are the frozen parameters of
// docs/EVALUATION_PROTOCOL.md; change them only by creating a new protocol version.
const PROFILES = Object.freeze({
  none: {},
  crash: { crash_before: 0.10, crash_after: 0.10 },
  'crash-noreconcile': { crash_before: 0.10, crash_after: 0.10, reconcile: false },
  delay: { hang: 0.05, delay: 0.15 },
  invalid_output: { invalid: 0.15 },
  false_claim: { false_claim: 0.15 },
  duplicate_delivery: { duplicate: 0.20 },
  dependency_failure: { permanent_failure: true },
  cancel: { cancel_at_fraction: 0.5 },
  mixed: { crash_before: 0.05, crash_after: 0.05, hang: 0.02, delay: 0.08, invalid: 0.06, false_claim: 0.06, duplicate: 0.10 },
});

// Mutually exclusive fates are drawn from one uniform and laid out in this order.
const EXCLUSIVE_ORDER = ['crash_before', 'crash_after', 'hang', 'delay', 'invalid', 'false_claim'];

class SeededPlan {
  constructor({ seed, profile, workload }) {
    if (!Object.hasOwn(PROFILES, profile)) throw new Error(`unknown fault profile: ${profile}`);
    this.seed = seed;
    this.profile = profile;
    this.params = PROFILES[profile];
    this.failTask = this.params.permanent_failure ? workload.fail_task : null;
    this.reconcileAvailable = this.params.reconcile !== false;
    this.cancelAt = this.params.cancel_at_fraction ? Math.round(workload.critical_path_ms * this.params.cancel_at_fraction) : null;
  }

  // Fate of attempt `attemptNo` of `taskId`. A pure function of (seed, task, attempt), independent of policy.
  fate(taskId, attemptNo) {
    const fate = { kind: 'normal', duplicate: false };
    if (taskId === this.failTask) { fate.kind = 'permanent_failure'; return fate; }
    const u = unit(`${this.seed}|${taskId}|${attemptNo}|fate`);
    let acc = 0;
    for (const kind of EXCLUSIVE_ORDER) {
      acc += this.params[kind] || 0;
      if (u < acc) { fate.kind = kind; break; }
    }
    const p = this.params.duplicate || 0;
    fate.duplicate = p > 0 && unit(`${this.seed}|${taskId}|${attemptNo}|dup`) < p;
    return fate;
  }
}

// Explicit fates for unit tests: { 'a.1': { kind: 'crash_after' }, ... } keyed by `${task}.${attempt}`.
class ScriptedPlan {
  constructor(script = {}, { reconcileAvailable = true } = {}) {
    this.script = script;
    this.reconcileAvailable = reconcileAvailable;
    this.cancelAt = null;
  }

  fate(taskId, attemptNo) {
    return { kind: 'normal', duplicate: false, ...(this.script[`${taskId}.${attemptNo}`] || {}) };
  }
}

module.exports = Object.freeze({ EXCLUSIVE_ORDER, PROFILES, ScriptedPlan, SeededPlan });
