'use strict';

// The invariant audit of a run log. ONE implementation, used by the engine (replay.js auditLog, the MCP verify tool, the
// benchmark) and, copied verbatim into the bundle by scripts/build-viewer.js, by the browser viewer. It is plain CommonJS with no
// imports so both can load it, and it never throws on a malformed entry.
//
// The hash chain is unsigned, so someone who can rewrite the whole log can produce a consistent one; this audit is the second
// line. Besides I1-I8 it requires that
//   - every attempt event belongs to an attempt that was started, for that task (A_*), and a settlement names one (S_*);
//   - a success rests on a claimed result AND a passing verdict about the same digest, or on a reconcile that found the effect applied (I1_*);
//   - the run starts once (again only when resumed) and records the digest of the spec (R_RUN_STARTED, R_SPEC_DIGEST);
//   - run_finished comes last and agrees with what the tasks did (R_FINISHED_*).
//
// `spec` may be null (log-only mode): the checks that need the task graph are then skipped, never reported as passed.
//   spec-dependent: I2 (dependencies), I3 (attempt budget, concurrency cap), I5 (effect class), tasks not declared by the run,
//                   the digest of the spec, run_finished against the dependency graph
// `expectedDigest` is the digest of the spec the caller holds (null: unknown).

const SETTLES_WITH_ATTEMPT = new Set(['succeeded', 'failed', 'unknown']);
const ATTEMPT_EVENTS = new Set(['attempt_result', 'gate_verdict', 'attempt_failed', 'attempt_ambiguous', 'reconcile', 'task_settled']);
const COUNT_KEYS = ['pending', 'running', 'verifying', 'succeeded', 'failed', 'blocked', 'unknown', 'cancelled'];
const OPEN_TASK = Object.freeze({ deps: [], max_attempts: Infinity, effect: null });

const isObj = (v) => v !== null && typeof v === 'object';

function auditCore({ spec = null, entries, expectedDigest = null }) {
  const violations = [];
  const flag = (code, entry, message) => violations.push({ code, seq: entry ? entry.seq : null, message });
  const taskById = spec ? new Map(spec.tasks.map((t) => [t.id, t])) : null;
  const succeeded = new Set();
  const terminal = new Set();
  const verdicts = new Map();             // attempt id -> { status, digest }
  const results = new Map();              // attempt id -> { claim, digest } of its attempt_result
  const started = new Map();              // attempt id -> task id
  const settled = new Map();              // task id -> last settled status
  const reconciledApplied = new Set();
  const startsByTask = new Map();
  const reconciledNotApplied = new Map(); // task -> attempt id whose reconcile said not_applied
  const inFlight = new Set();
  const runStarts = [];
  let finished = false;
  let cancelled = false;
  const cap = spec ? spec.max_concurrency : Infinity;

  entries.forEach((e, index) => {
    if (!isObj(e)) return;
    const data = isObj(e.data) ? e.data : {};
    let task = null;
    if (e.task) task = spec ? (taskById.get(e.task) || null) : OPEN_TASK;
    if (finished && e.type !== 'run_finished') flag('R_FINISHED_NOT_LAST', e, `${e.type} follows run_finished`);
    if (e.attempt && ATTEMPT_EVENTS.has(e.type)) {
      if (!started.has(e.attempt)) flag('A_NO_START', e, `${e.type} for attempt ${e.attempt}, which was never started`);
      else if (started.get(e.attempt) !== e.task) flag('A_TASK_MISMATCH', e, `${e.type} names task ${e.task} but attempt ${e.attempt} belongs to ${started.get(e.attempt)}`);
    }
    switch (e.type) {
      case 'run_started': {
        const digest = data.spec_digest;
        if (runStarts.length === 0 && index !== 0) flag('R_RUN_STARTED', e, 'run_started is not the first entry');
        if (runStarts.length > 0 && data.resumed !== true) flag('R_RUN_STARTED', e, 'a second run_started that is not marked resumed');
        if (runStarts.length > 0 && digest !== runStarts[0].digest) flag('R_SPEC_DIGEST', e, 'the spec digest changed between run_started entries');
        if (expectedDigest !== null && digest !== expectedDigest) flag('R_SPEC_DIGEST', e, 'run_started.spec_digest is not the digest of this spec');
        if (spec && typeof data.tasks === 'number' && data.tasks !== spec.tasks.length) flag('R_RUN_STARTED', e, `run_started says ${data.tasks} tasks, the spec has ${spec.tasks.length}`);
        runStarts.push({ digest, tasks: data.tasks });
        break;
      }
      case 'attempt_started': {
        if (!task) { flag('UNKNOWN_TASK', e, `attempt for unknown task ${e.task}`); break; }
        if (cancelled) flag('I7_START_AFTER_CANCEL', e, `${e.task} started after cancellation`);
        if (terminal.has(e.task)) flag('I4_START_AFTER_TERMINAL', e, `${e.task} started after settling`);
        for (const dep of task.deps) if (!succeeded.has(dep)) flag('I2_DEP_NOT_SUCCEEDED', e, `${e.task} started before ${dep} succeeded`);
        const n = (startsByTask.get(e.task) || 0) + 1;
        startsByTask.set(e.task, n);
        if (data.no !== n) flag('ATTEMPT_NUMBERING', e, `${e.task} attempt number ${data.no}, expected ${n}`);
        if (e.attempt !== `${e.task}.${data.no}`) flag('A_NO_START', e, `attempt id ${e.attempt} does not match ${e.task}.${data.no}`);
        if (started.has(e.attempt)) flag('A_NO_START', e, `attempt ${e.attempt} started twice`);
        started.set(e.attempt, e.task);
        if (n > task.max_attempts) flag('I3_ATTEMPT_BUDGET', e, `${e.task} exceeded ${task.max_attempts} attempts`);
        if (task.effect === 'external-nonrepeatable' && n > 1 && reconciledNotApplied.get(e.task) !== `${e.task}.${n - 1}`) {
          flag('I5_NONREPEATABLE_RESTART', e, `${e.task} restarted without evidence that attempt ${n - 1} did not apply`);
        }
        inFlight.add(e.task);
        if (inFlight.size > cap) flag('I3_CONCURRENCY', e, `${inFlight.size} attempts in flight, cap is ${cap}`);
        break;
      }
      case 'attempt_result':
        if (results.has(e.attempt)) flag('I6_DOUBLE_INGEST', e, `attempt ${e.attempt} ingested twice`);
        results.set(e.attempt, { claim: data.claim, digest: data.digest });
        break;
      case 'gate_verdict':
        verdicts.set(e.attempt, { status: data.status, digest: data.digest });
        break;
      case 'reconcile':
        if (data.outcome === 'not_applied') reconciledNotApplied.set(e.task, e.attempt);
        if (data.outcome === 'applied') reconciledApplied.add(e.attempt);
        break;
      case 'attempt_failed':
        if (data.retry) inFlight.delete(e.task);
        break;
      case 'task_settled': {
        if (terminal.has(e.task)) flag('I4_TERMINAL_CHANGED', e, `${e.task} settled twice`);
        if (spec && !task) flag('UNKNOWN_TASK', e, `settlement of unknown task ${e.task}`);
        if (SETTLES_WITH_ATTEMPT.has(data.status) && !e.attempt) flag('S_SETTLED_WITHOUT_START', e, `${e.task} settled ${data.status} without naming an attempt`);
        if (data.status === 'succeeded') {
          const v = verdicts.get(e.attempt);
          if (!v || v.status !== 'pass' || v.digest !== data.digest) flag('I1_UNVERIFIED_SUCCESS', e, `${e.task} succeeded without a matching passing verdict`);
          const r = results.get(e.attempt);
          if (r && r.claim === 'success') {
            if (v && r.digest !== v.digest) flag('I1_RESULT_DIGEST', e, `${e.task}: the result claimed one digest, the gate judged another`);
          } else if (v && !reconciledApplied.has(e.attempt)) {
            flag('I1_NO_RESULT', e, `${e.task} succeeded without a claimed result or a reconcile that found the effect applied`);
          }
          succeeded.add(e.task);
        }
        terminal.add(e.task);
        settled.set(e.task, data.status);
        inFlight.delete(e.task);
        break;
      }
      case 'cancel_requested':
        cancelled = true;
        break;
      case 'run_finished':
        if (finished) flag('R_FINISHED_NOT_LAST', e, 'run_finished appears twice');
        finished = true;
        checkRunFinished({ spec, e, data, settled, cancelled, declared: runStarts.length ? runStarts[0].tasks : undefined, flag });
        break;
      default:
        break;
    }
  });
  return violations;
}

// run_finished must say what the tasks did. With a spec the blocked tasks are derived from the dependency graph (a task that never
// settled must depend, directly or not, on one that did not succeed); without one, blocked is "declared tasks minus settled".
// The status is the engine's rule: cancelled > failed > unknown > blocked > succeeded.
function checkRunFinished({ spec, e, data, settled, cancelled, declared, flag }) {
  const counts = { pending: 0, running: 0, verifying: 0, succeeded: 0, failed: 0, blocked: 0, unknown: 0, cancelled: 0 };
  for (const status of settled.values()) if (Object.hasOwn(counts, status)) counts[status]++;
  let blockedKnown = true;
  if (spec) {
    const unsettled = spec.tasks.filter((t) => !settled.has(t.id));
    const blocked = new Set();
    for (let changed = true; changed;) {
      changed = false;
      for (const t of unsettled) {
        if (blocked.has(t.id)) continue;
        if (t.deps.some((dep) => blocked.has(dep) || (settled.has(dep) && settled.get(dep) !== 'succeeded'))) { blocked.add(t.id); changed = true; }
      }
    }
    for (const t of unsettled) if (!blocked.has(t.id)) flag('R_FINISHED_INCOMPLETE', e, `run_finished while ${t.id} neither settled nor blocked`);
    counts.blocked = blocked.size;
  } else if (typeof declared === 'number' && declared >= settled.size) {
    counts.blocked = declared - settled.size;
  } else {
    blockedKnown = false;
    if (typeof declared === 'number') flag('R_FINISHED_COUNTS', e, `${settled.size} tasks settled but run_started declared ${declared}`);
  }
  const c = data.counts;
  const mismatch = !isObj(c) || COUNT_KEYS.some((k) => (k !== 'blocked' || blockedKnown) && c[k] !== counts[k]);
  if (mismatch) flag('R_FINISHED_COUNTS', e, `run_finished counts ${JSON.stringify(c)} do not match the settled tasks ${JSON.stringify(counts)}`);
  let status = 'succeeded';
  if (cancelled) status = 'cancelled';
  else if (counts.failed) status = 'failed';
  else if (counts.unknown) status = 'unknown';
  else if (counts.blocked || (!blockedKnown && isObj(c) && c.blocked)) status = 'blocked';
  if (data.status !== status) flag('R_FINISHED_STATUS', e, `run_finished says ${data.status}, the tasks say ${status}`);
}

module.exports = { auditCore };
