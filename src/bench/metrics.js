'use strict';

// Per-run metrics, as defined in docs/EVALUATION_PROTOCOL.md. Computed from the ground-truth world ledger and
// the workload's known-correct digests; an orchestrator's own claims are only consulted for what status it
// *reported*. `null` means "not measurable for this run" and is never coerced to zero.

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function computeMetrics({ workload, policy, report, world, stats, cancelAt, makespanMs, auditViolations }) {
  const tasks = workload.spec.tasks;
  const n = tasks.length;
  let succeeded = 0;
  let correct = 0;
  let falseSuccess = 0;
  const status = { succeeded: 0, failed: 0, blocked: 0, unknown: 0, cancelled: 0 };
  const isCorrect = new Map();
  for (const task of tasks) {
    const r = report.tasks[task.id];
    status[r.status] = (status[r.status] || 0) + 1;
    const ok = r.status === 'succeeded';
    const right = ok && r.artifacts_digest === workload.expected[task.id];
    isCorrect.set(task.id, right);
    if (ok) succeeded++;
    if (right) correct++;
    if (ok && !right) falseSuccess++;
  }

  const duplicated = workload.nonrepeatable.filter((id) => world.effectCount(id) > 1).length;
  const crashed = tasks.filter((t) => world.crashes.get(t.id) > 0);
  const recovered = crashed.filter((t) => isCorrect.get(t.id)).length;

  let effectsAfterCancel = null;
  if (cancelAt !== null) {
    effectsAfterCancel = 0;
    for (const task of tasks) for (const at of world.effects.get(task.id).times) if (at > cancelAt) effectsAfterCancel++;
  }

  const effectiveCap = policy === 'sequential' || policy === 'gated-sequential' ? 1 : workload.spec.max_concurrency;
  const tokens = world.tokens;
  return {
    correct_completion: correct / n,
    false_success_rate: ratio(falseSuccess, succeeded),
    unsafe_final_status: ratio(falseSuccess, n - correct),
    duplicate_effect_rate: ratio(duplicated, workload.nonrepeatable.length),
    dependency_order_violations: stats.violations,
    effects_after_cancel: effectsAfterCancel,
    recovery_rate: ratio(recovered, crashed.length),
    makespan_ms: makespanMs,
    incomplete: Boolean(report.incomplete),
    tokens,
    tokens_per_correct: ratio(tokens, correct),
    attempts: world.attemptsStarted,
    peak_inflight: stats.peak,
    cap_exceeded: stats.peak > effectiveCap,
    duplicates_ignored: report.duplicates_ignored || 0,
    n_correct: correct,
    n_succeeded: succeeded,
    n_false_success: falseSuccess,
    n_unknown: status.unknown,
    n_failed: status.failed,
    n_blocked: status.blocked,
    n_cancelled: status.cancelled,
    audit_violations: auditViolations,
  };
}

// Metrics that are summarized (mean + CI) and compared pairwise, with the direction in which larger is better.
const COMPARED_METRICS = Object.freeze([
  ['correct_completion', true],
  ['false_success_rate', false],
  ['unsafe_final_status', false],
  ['duplicate_effect_rate', false],
  ['dependency_order_violations', false],
  ['effects_after_cancel', false],
  ['recovery_rate', true],
  ['makespan_ms', false],
  ['tokens_per_correct', false],
  ['attempts', false],
]);

module.exports = Object.freeze({ COMPARED_METRICS, computeMetrics });
