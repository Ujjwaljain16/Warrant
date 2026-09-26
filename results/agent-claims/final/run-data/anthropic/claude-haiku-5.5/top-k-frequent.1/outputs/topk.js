'use strict';

function topK(items, k) {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError('k must be a non-negative integer');
  }

  if (!Array.isArray(items) || !items.every(item => typeof item === 'string')) {
    throw new TypeError('items must be an array of strings');
  }

  const counts = {};
  for (const item of items) {
    counts[item] = (counts[item] || 0) + 1;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, k)
    .map(([str]) => str);

  return sorted;
}

module.exports = { topK };
