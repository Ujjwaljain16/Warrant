'use strict';

function rotate(items, k) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Number.isInteger(k)) throw new RangeError('k must be an integer');
  const n = items.length;
  if (n === 0) return [];
  const shift = ((k % n) + n) % n;
  return [...items.slice(n - shift), ...items.slice(0, n - shift)];
}

module.exports = { rotate };
