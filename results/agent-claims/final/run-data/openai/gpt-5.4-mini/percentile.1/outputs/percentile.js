'use strict';

function percentile(values, p) {
  if (typeof p !== 'number' || p < 0 || p > 100) {
    throw new RangeError('percentile: p must be a number from 0 to 100 inclusive');
  }
  const n = values.length;
  if (n === 0) {
    throw new RangeError('percentile: values must be a non-empty array');
  }
  const sorted = values.slice().sort((a, b) => a - b);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(sorted[i])) {
      throw new TypeError('percentile: every value must be a finite number');
    }
  }
  const rank = p / 100 * (n - 1);
  const lowerIndex = Math.floor(rank);
  const lowerValue = sorted[lowerIndex];
  const upperValue = sorted[lowerIndex + 1];
  if (Number.isNaN(lowerValue) || Number.isNaN(upperValue)) {
    return NaN;
  }
  if (lowerValue === upperValue) {
    return lowerValue;
  }
  const fraction = rank - lowerIndex;
  return lowerValue + fraction * (upperValue - lowerValue);
}

module.exports = { percentile };