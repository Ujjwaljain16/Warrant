'use strict';

function lastN(items, n) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  return items.slice(Math.max(0, items.length - n));
}

module.exports = { lastN };
