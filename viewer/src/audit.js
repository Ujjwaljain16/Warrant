'use strict';

// The invariant audit of src/engine/replay.js auditLog, ported to run in the browser.
//
// With a spec the answers are identical to auditLog (test/viewer.test.js compares them on logs produced by the real
// engine). Without a spec, only what the log alone can show is checked; the spec-dependent checks are reported as
// "needs spec", never as passed:
//   needs spec:  I2 (dependencies), I3 (attempt budget, concurrency cap), I5 (effect class), tasks not declared by the run
//   log only:    I1, I4, I6, I7, I8 and attempt numbering

const { STATUS } = require('./states');

const INVARIANTS = Object.freeze([
  { id: 'I1', title: 'Success needs a verdict', detail: 'A task is succeeded only if the log holds a passing gate verdict for that attempt, bound to the same artifact digest.', codes: ['I1_UNVERIFIED_SUCCESS'], needsSpec: false },
  { id: 'I2', title: 'Dependencies first', detail: 'An attempt starts only after every dependency has succeeded.', codes: ['I2_DEP_NOT_SUCCEEDED'], needsSpec: true },
  { id: 'I3', title: 'Bounded attempts and concurrency', detail: 'Attempts per task stay within max_attempts; attempts in flight stay within max_concurrency.', codes: ['I3_ATTEMPT_BUDGET', 'I3_CONCURRENCY'], needsSpec: true },
  { id: 'I4', title: 'Terminal states are final', detail: 'Nothing starts after a task has settled, and a task settles once.', codes: ['I4_START_AFTER_TERMINAL', 'I4_TERMINAL_CHANGED'], needsSpec: false },
  { id: 'I5', title: 'No guessed repeats of one-shot effects', detail: 'An external-nonrepeatable task is restarted only after a reconcile proved the earlier attempt did not apply.', codes: ['I5_NONREPEATABLE_RESTART'], needsSpec: true },
  { id: 'I6', title: 'Each result ingested once', detail: 'A second result for the same attempt is logged as a duplicate, never ingested again.', codes: ['I6_DOUBLE_INGEST'], needsSpec: false },
  { id: 'I7', title: 'Nothing starts after cancel', detail: 'Once cancellation is requested, no new attempt begins.', codes: ['I7_START_AFTER_CANCEL'], needsSpec: false },
  { id: 'I8', title: 'Hash chain verifies', detail: 'Every entry commits to its content and to the previous entry; sequence numbers are contiguous.', codes: ['I8_CHAIN'], needsSpec: false },
  { id: 'ATTEMPTS', title: 'Attempt numbering', detail: 'Attempts of a task are numbered 1, 2, 3 without gaps.', codes: ['ATTEMPT_NUMBERING'], needsSpec: false },
  { id: 'TASKS', title: 'Known tasks only', detail: 'Every attempt belongs to a task the run declared.', codes: ['UNKNOWN_TASK'], needsSpec: true },
]);

/**
 * Same walk as auditLog. `spec` may be null (log-only mode). `chain` is the result of verifyChain (the engine calls
 * verifyEntries itself; the viewer verifies asynchronously first and passes the outcome in).
 */
function auditLog(spec, entries, chain) {
  const violations = [];
  const flag = (code, entry, message) => violations.push({ code, seq: entry ? entry.seq : null, message });
  if (chain && chain.status === 'broken') { flag('I8_CHAIN', null, chain.broken.message); return violations; }

  const taskById = spec ? new Map(spec.tasks.map((t) => [t.id, t])) : null;
  const open = { deps: [], max_attempts: Infinity, effect: null };
  const succeeded = new Set();
  const terminal = new Set();
  const verdicts = new Map();
  const resultsSeen = new Set();
  const startsByTask = new Map();
  const reconciledNotApplied = new Map();
  const inFlight = new Set();
  let cancelled = false;
  const cap = spec ? spec.max_concurrency : Infinity;

  for (const e of entries) {
    let task = null;
    if (e.task) task = spec ? (taskById.get(e.task) || null) : open;
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
 * Per-invariant report for the UI: one row per invariant with state
 * 'ok' | 'violated' | 'needs-spec' | 'prefix-ok' (chain broken: no violation in the verified prefix, rest unchecked).
 * `violations` is the auditLog result; when the chain is broken, pass the I8 violation plus the audit of the verified prefix.
 */
function invariantReport(violations, { hasSpec, chainBroken }) {
  return INVARIANTS.map((inv) => {
    const mine = violations.filter((v) => inv.codes.includes(v.code));
    let state = 'ok';
    if (mine.length) state = 'violated';
    else if (inv.needsSpec && !hasSpec) state = 'needs-spec';
    else if (chainBroken && inv.id !== 'I8') state = 'prefix-ok';
    return { id: inv.id, title: inv.title, detail: inv.detail, needsSpec: inv.needsSpec, state, violations: mine };
  });
}

module.exports = { INVARIANTS, auditLog, invariantReport };
