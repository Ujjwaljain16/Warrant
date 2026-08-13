'use strict';

const { hash32 } = require('../sim/rng');

// Statistics for the benchmark. Everything here is deterministic: bootstrap resampling uses a seeded
// generator, so the same raw results always produce the same summary.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

// Linear-interpolated percentile of an unsorted array; p in [0, 100].
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

// Percentile bootstrap CI for the mean. `label` makes the resampling stream reproducible per statistic.
function bootstrapMeanCI(values, { label = '', resamples = 2000, level = 0.95 } = {}) {
  const n = values.length;
  if (n === 0) return null;
  if (n === 1) return { lo: values[0], hi: values[0] };
  const rand = mulberry32(hash32(`bootstrap|${label}|${n}`));
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[(rand() * n) | 0];
    means[r] = s / n;
  }
  means.sort();
  const alpha = (1 - level) / 2;
  return { lo: means[Math.floor(alpha * resamples)], hi: means[Math.min(resamples - 1, Math.ceil((1 - alpha) * resamples) - 1)] };
}

// Summary of a metric across trials. Nulls are *missing*, not zero: they are excluded from the mean and counted.
function summarize(values, label) {
  const valid = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const out = { n: values.length, n_valid: valid.length, n_missing: values.length - valid.length, mean: null, ci95: null };
  if (valid.length === 0) return out;
  out.mean = mean(valid);
  out.ci95 = bootstrapMeanCI(valid, { label });
  return out;
}

function latencySummary(values) {
  if (values.length === 0) return { n: 0, p50: null, p95: null, max: null };
  return { n: values.length, p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values) };
}

// Paired difference (a - b) over trials where BOTH have a value. Verdict only when the CI excludes zero.
function pairedDifference(pairs, label) {
  const diffs = [];
  for (const [a, b] of pairs) if (a !== null && a !== undefined && b !== null && b !== undefined) diffs.push(a - b);
  if (diffs.length === 0) return { n_pairs: 0, mean_diff: null, ci95: null };
  return { n_pairs: diffs.length, mean_diff: mean(diffs), ci95: bootstrapMeanCI(diffs, { label }) };
}

function verdict(diff, higherIsBetter) {
  if (!diff.ci95) return 'no-data';
  const { lo, hi } = diff.ci95;
  if (lo <= 0 && hi >= 0) return 'inconclusive';
  const positive = lo > 0;
  return positive === higherIsBetter ? 'better' : 'worse';
}

module.exports = Object.freeze({ bootstrapMeanCI, latencySummary, mean, mulberry32, pairedDifference, percentile, summarize, verdict });
