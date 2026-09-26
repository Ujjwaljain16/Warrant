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

  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'number' || !isFinite(values[i])) {
      throw new TypeError('every value must be a finite number');
    }
  }

  // Sort values in ascending order (do not modify the input array)
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Calculate rank
  const rank = (p / 100) * (n - 1);

  // Get the integer and fractional parts of the rank
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  // If rank is an exact integer, return that value
  if (lower === upper) {
    return sorted[lower];
  }

  // Linear interpolation between the two values
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

module.exports = { percentile };
