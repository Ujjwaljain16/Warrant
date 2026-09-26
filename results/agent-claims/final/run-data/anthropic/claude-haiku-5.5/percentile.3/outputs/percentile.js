'use strict';

function percentile(values, p) {
  // Validate p
  if (typeof p !== 'number' || p < 0 || p > 100) {
    throw new RangeError('p must be a number between 0 and 100 inclusive');
  }

  // Validate values
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('values must be a non-empty array');
  }

  // Validate each value is a finite number
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'number' || !Number.isFinite(values[i])) {
      throw new TypeError('every value must be a finite number');
    }
  }

  // Create a sorted copy (don't modify the input array)
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Calculate rank
  const rank = (p / 100) * (n - 1);

  // Get the integer and fractional parts
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  // If rank is exact (integer), return that value
  if (lower === upper) {
    return sorted[lower];
  }

  // Interpolate linearly between the two values
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

module.exports = { percentile };
