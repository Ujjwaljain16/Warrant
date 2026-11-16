'use strict';

function percentile(values, p) {
  if (typeof p !== 'number' || !(p >= 0 && p <= 100)) {
    throw new RangeError('p must be a number from 0 to 100 inclusive');
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('values must be a non-empty array');
  }
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError('every value must be a finite number');
    }
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sorted[lo];
  }
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

module.exports = { percentile };
