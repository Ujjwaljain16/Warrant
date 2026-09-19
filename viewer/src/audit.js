'use strict';

// The invariant audit of src/engine/replay.js auditLog, ported to run in the browser.
//
// With a spec the answers are identical to auditLog (test/viewer.test.js compares them on logs produced by the real
// engine). Without a spec, only what the log alone can show is checked; the spec-dependent checks are reported as
// "needs spec", never as passed:
//   needs spec:  I2 (dependencies), I3 (attempt budget, concurrency cap), I5 (effect class), tasks not declared by the run
//   log only:    I1, I4, I6, I7, I8 and attempt numbering

const { auditCore } = require('./audit-core');

const INVARIANTS = Object.freeze([
  { id: 'I1', title: 'Success needs a verdict', detail: 'A task is succeeded only if the log holds a claimed result and a passing gate verdict for that attempt, both bound to the same artifact digest.', codes: ['I1_UNVERIFIED_SUCCESS', 'I1_RESULT_DIGEST', 'I1_NO_RESULT'], needsSpec: false },
  { id: 'I2', title: 'Dependencies first', detail: 'An attempt starts only after every dependency has succeeded.', codes: ['I2_DEP_NOT_SUCCEEDED'], needsSpec: true },
  { id: 'I3', title: 'Bounded attempts and concurrency', detail: 'Attempts per task stay within max_attempts; attempts in flight stay within max_concurrency.', codes: ['I3_ATTEMPT_BUDGET', 'I3_CONCURRENCY'], needsSpec: true },
  { id: 'I4', title: 'Terminal states are final', detail: 'Nothing starts after a task has settled, and a task settles once.', codes: ['I4_START_AFTER_TERMINAL', 'I4_TERMINAL_CHANGED'], needsSpec: false },
  { id: 'I5', title: 'No guessed repeats of one-shot effects', detail: 'An external-nonrepeatable task is restarted only after a reconcile proved the earlier attempt did not apply.', codes: ['I5_NONREPEATABLE_RESTART'], needsSpec: true },
  { id: 'I6', title: 'Each result ingested once', detail: 'A second result for the same attempt is logged as a duplicate, never ingested again.', codes: ['I6_DOUBLE_INGEST'], needsSpec: false },
  { id: 'I7', title: 'Nothing starts after cancel', detail: 'Once cancellation is requested, no new attempt begins.', codes: ['I7_START_AFTER_CANCEL'], needsSpec: false },
  { id: 'I8', title: 'Hash chain verifies', detail: 'Every entry commits to its content and to the previous entry; sequence numbers are contiguous.', codes: ['I8_CHAIN'], needsSpec: false },
  { id: 'ATTEMPTS', title: 'Attempt numbering', detail: 'Attempts of a task are numbered 1, 2, 3 without gaps.', codes: ['ATTEMPT_NUMBERING'], needsSpec: false },
  { id: 'LINKS', title: 'Events belong to started attempts', detail: 'Every result, verdict, failure or settlement names an attempt that was started for that task; a success, failure or unknown outcome names its attempt.', codes: ['A_NO_START', 'A_TASK_MISMATCH', 'S_SETTLED_WITHOUT_START'], needsSpec: false },
  { id: 'RUN', title: 'Run start and finish are consistent', detail: 'The run starts once (again only when resumed) with the digest of the spec; run_finished comes last and its status and counts match what the tasks did.', codes: ['R_RUN_STARTED', 'R_SPEC_DIGEST', 'R_FINISHED_NOT_LAST', 'R_FINISHED_INCOMPLETE', 'R_FINISHED_COUNTS', 'R_FINISHED_STATUS'], needsSpec: false },
  { id: 'TASKS', title: 'Known tasks only', detail: 'Every attempt belongs to a task the run declared.', codes: ['UNKNOWN_TASK'], needsSpec: true },
]);

/**
 * The same audit as auditLog in src/engine/replay.js: both call audit-core.js, which is the one implementation (the build copies
 * src/engine/audit-core.js into the bundle). spec may be null (log-only mode). chain is the result of verifyChain (the engine calls
 * verifyEntries itself; the viewer verifies asynchronously first and passes the outcome in). expectedDigest is the digest of the spec
 * the user supplied, computed by the caller (WebCrypto is asynchronous), or null.
 */
function auditLog(spec, entries, chain, expectedDigest = null) {
  if (chain && chain.status === 'broken') return [{ code: 'I8_CHAIN', seq: null, message: chain.broken.message }];
  return auditCore({ spec, entries, expectedDigest });
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
