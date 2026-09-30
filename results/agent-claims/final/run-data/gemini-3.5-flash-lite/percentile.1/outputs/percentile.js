'use strict';

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('values must be a non-empty array');
  }
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 100) {
    throw new RangeError('p must be a number from 0 to 100 inclusive');
  }

  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError('every value must be a finite number');
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = (p / 100) * (n - 1);

  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const lowerValue = sorted[lowerIndex];
  const upperValue = sorted[upperIndex];
  const weight = rank - lowerIndex;

  return lowerValue + (upperValue - lowerValue) * weight;
}

module.exports = { percentile };
