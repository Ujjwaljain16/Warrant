'use strict';

function percentile(values, p) {
  // Validate p
  if (typeof p !== 'number' || p < 0 || p > 100) {
    throw new RangeError('p must be a number between 0 and 100');
  }

  // Validate values
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('values must be a non-empty array');
  }

  for (const value of values) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new TypeError('every value must be a finite number');
    }
  }

  // Sort values in ascending order
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Calculate rank
  const rank = (p / 100) * (n - 1);

  // If rank is an integer, return the value at that index
  if (rank === Math.floor(rank)) {
    return sorted[rank];
  }

  // Otherwise, interpolate between the two closest values
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

module.exports = { percentile };
