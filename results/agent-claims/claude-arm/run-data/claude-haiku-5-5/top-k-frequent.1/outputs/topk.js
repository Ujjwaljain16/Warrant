'use strict';

function topK(items, k) {
  if (!Array.isArray(items) || !items.every((x) => typeof x === 'string')) {
    throw new TypeError('items must be an array of strings');
  }
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError('k must be a non-negative integer');
  }

  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  const entries = Array.from(counts, ([value, count]) => ({ value, count }));
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return 0;
  });

  return entries.slice(0, k).map((e) => e.value);
}

module.exports = { topK };
