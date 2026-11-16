'use strict';

function rotate(items, k) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (!Number.isInteger(k)) {
    throw new RangeError('k must be an integer');
  }

  const n = items.length;
  if (n === 0) {
    return [];
  }

  // Normalise to a right-rotation amount in [0, n). Negative k rotates left.
  const shift = ((k % n) + n) % n;
  const split = n - shift;
  return [...items.slice(split), ...items.slice(0, split)];
}

module.exports = { rotate };
