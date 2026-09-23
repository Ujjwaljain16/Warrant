'use strict';

function percentile(values, p) {
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 100) throw new RangeError('p must be a number from 0 to 100');
  if (!Array.isArray(values) || values.length === 0) throw new RangeError('values must be a non-empty array');
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new TypeError('values must be finite numbers');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

module.exports = { percentile };
