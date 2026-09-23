'use strict';

const { hash32 } = require('../sim/rng');
const { mulberry32 } = require('./stats');

// Statistics for the agent-claims experiment (docs/AGENT_CLAIMS_PROTOCOL.md). Deterministic: every resampling stream is
// seeded from a label, so the same results files always give the same intervals.
const BOOTSTRAP_SEED = 1729;
const RESAMPLES = 10_000;

// Wilson score interval for k successes in n trials. It ignores that runs of one task are correlated, so it is
// reported next to (never instead of) the task-clustered interval.
function wilson(k, n, z = 1.96) {
  if (!Number.isInteger(n) || n <= 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const ratio = (num, den) => (den > 0 ? num / den : null);

function percentileInterval(values) {
  values.sort((a, b) => a - b);
  return { lo: values[Math.floor(0.025 * values.length)], hi: values[Math.min(values.length - 1, Math.ceil(0.975 * values.length) - 1)] };
}

/**
 * Task-clustered bootstrap for a pooled ratio sum(num) / sum(den). `clusters` has one entry per task, { num, den } (the runs
 * of a task are summed). Whole tasks are resampled with replacement, so the interval reflects that runs of one task are not
 * independent. Resamples whose denominator is 0 are discarded and counted. Nulls when nothing is defined.
 */
function clusterRatio(clusters, label) {
  const den = clusters.reduce((s, c) => s + c.den, 0);
  const num = clusters.reduce((s, c) => s + c.num, 0);
  const out = { estimate: ratio(num, den), num, den, n_clusters: clusters.filter((c) => c.den > 0).length, ci95: null, resamples_used: 0, wilson: wilson(num, den) };
  if (den === 0 || clusters.length === 0) return out;
  const rand = mulberry32(hash32(`${BOOTSTRAP_SEED}|${label}`));
  const values = [];
  for (let r = 0; r < RESAMPLES; r++) {
    let n = 0;
    let d = 0;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[(rand() * clusters.length) | 0];
      n += c.num;
      d += c.den;
    }
    if (d > 0) values.push(n / d);
  }
  out.resamples_used = values.length;
  if (values.length >= RESAMPLES / 2) out.ci95 = percentileInterval(values);
  return out;
}

/**
 * Paired difference of two pooled ratios over the same clusters: each cluster has { numA, denA, numB, denB }. The same
 * resampled tasks feed both ratios, so the interval is for (A - B). The verdict is 'a-lower' / 'b-lower' only when the
 * interval excludes 0, otherwise 'inconclusive' ('n/a' when a ratio is undefined).
 */
function clusterDifference(clusters, label) {
  const sum = (key) => clusters.reduce((s, c) => s + c[key], 0);
  const ra = ratio(sum('numA'), sum('denA'));
  const rb = ratio(sum('numB'), sum('denB'));
  const out = { a: ra, b: rb, diff: ra === null || rb === null ? null : ra - rb, ci95: null, verdict: 'n/a', resamples_used: 0 };
  if (out.diff === null) return out;
  const rand = mulberry32(hash32(`${BOOTSTRAP_SEED}|${label}`));
  const values = [];
  for (let r = 0; r < RESAMPLES; r++) {
    let na = 0; let da = 0; let nb = 0; let db = 0;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[(rand() * clusters.length) | 0];
      na += c.numA; da += c.denA; nb += c.numB; db += c.denB;
    }
    if (da > 0 && db > 0) values.push(na / da - nb / db);
  }
  out.resamples_used = values.length;
  if (values.length >= RESAMPLES / 2) {
    out.ci95 = percentileInterval(values);
    out.verdict = out.ci95.lo > 0 ? 'b-lower' : out.ci95.hi < 0 ? 'a-lower' : 'inconclusive';
  }
  return out;
}

module.exports = Object.freeze({ BOOTSTRAP_SEED, RESAMPLES, clusterDifference, clusterRatio, ratio, wilson });
