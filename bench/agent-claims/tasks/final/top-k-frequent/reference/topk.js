'use strict';

function topK(items, k) {
  if (!Array.isArray(items) || !items.every((s) => typeof s === 'string')) throw new TypeError('items must be an array of strings');
  if (!Number.isInteger(k) || k < 0) throw new RangeError('k must be a non-negative integer');
  const counts = new Map();
  for (const s of items) counts.set(s, (counts.get(s) || 0) + 1);
  const order = (a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return [...counts.entries()].sort(order).slice(0, k).map((entry) => entry[0]);
}

module.exports = { topK };
