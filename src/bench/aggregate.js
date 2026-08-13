'use strict';

const { COMPARED_METRICS } = require('./metrics');
const { latencySummary, pairedDifference, summarize, verdict } = require('./stats');

// Which policy pairs are compared, and why:
//   gated vs sequential / naive-parallel / naive-parallel-timeout : the headline question; the timeout variant is the
//     closest baseline (same deadlines and retries, but no gate, no dedup, no reconcile)
//   gated-sequential vs sequential       : effect of the gate alone, parallelism held equal (ablation)
//   gated vs gated-sequential            : effect of parallelism, gate held equal (ablation)
const COMPARISONS = Object.freeze([
  ['gated', 'sequential'],
  ['gated', 'naive-parallel'],
  ['gated', 'naive-parallel-timeout'],
  ['gated-sequential', 'sequential'],
  ['gated', 'gated-sequential'],
]);

const key = (r) => `${r.workload}|${r.profile}|${r.policy}`;

function groupRecords(records) {
  const groups = new Map();
  for (const r of records) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const list of groups.values()) list.sort((a, b) => a.seed - b.seed);
  return groups;
}

function summarizeGroup(recs, label) {
  const metrics = {};
  for (const [name] of COMPARED_METRICS) metrics[name] = summarize(recs.map((r) => r[name]), `${label}|${name}`);
  return {
    trials: recs.length,
    metrics,
    makespan_ms: latencySummary(recs.map((r) => r.makespan_ms)),
    incomplete_runs: recs.filter((r) => r.incomplete).length,
    cap_exceeded_runs: recs.filter((r) => r.cap_exceeded).length,
    audit_violations: recs.reduce((s, r) => s + (r.audit_violations || 0), 0),
    audited_runs: recs.filter((r) => r.audit_violations !== null && r.audit_violations !== undefined).length,
  };
}

function compare(listA, listB, label) {
  const out = {};
  for (const [name, higherIsBetter] of COMPARED_METRICS) {
    const pairs = listA.map((a, i) => [a[name], listB[i][name]]);
    const diff = pairedDifference(pairs, `${label}|${name}`);
    out[name] = { ...diff, higher_is_better: higherIsBetter, verdict: verdict(diff, higherIsBetter) };
  }
  return out;
}

/**
 * records: one object per trial ({ workload, profile, policy, seed, ...metrics }).
 * Returns per-cell summaries, pooled-across-workloads summaries, and paired comparisons.
 */
function aggregate(records) {
  const groups = groupRecords(records);
  const workloads = [...new Set(records.map((r) => r.workload))];
  const profiles = [...new Set(records.map((r) => r.profile))];
  const policies = [...new Set(records.map((r) => r.policy))];

  const cells = [];
  const pooled = [];
  const comparisons = [];

  for (const profile of profiles) {
    for (const policy of policies) {
      for (const workload of workloads) {
        const recs = groups.get(`${workload}|${profile}|${policy}`);
        if (recs) cells.push({ workload, profile, policy, ...summarizeGroup(recs, `${workload}|${profile}|${policy}`) });
      }
      const all = workloads.flatMap((w) => groups.get(`${w}|${profile}|${policy}`) || []);
      if (all.length) pooled.push({ workload: 'ALL', profile, policy, ...summarizeGroup(all, `ALL|${profile}|${policy}`) });
    }
    for (const [a, b] of COMPARISONS) {
      const scopes = [...workloads.map((w) => [w, [w]]), ['ALL', workloads]];
      for (const [scope, ws] of scopes) {
        const listA = ws.flatMap((w) => groups.get(`${w}|${profile}|${a}`) || []);
        const listB = ws.flatMap((w) => groups.get(`${w}|${profile}|${b}`) || []);
        if (listA.length === 0 || listA.length !== listB.length) continue;
        // Pairs are aligned by (workload, seed) because both lists are built in the same order; verify, never assume.
        for (let i = 0; i < listA.length; i++) {
          if (listA[i].seed !== listB[i].seed || listA[i].workload !== listB[i].workload) throw new Error(`pair misalignment at ${scope}|${profile}|${a}~${b}#${i}`);
        }
        comparisons.push({ workload: scope, profile, a, b, metrics: compare(listA, listB, `${scope}|${profile}|${a}~${b}`) });
      }
    }
  }
  return { cells, pooled, comparisons };
}

module.exports = Object.freeze({ COMPARISONS, aggregate });
