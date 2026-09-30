'use strict';

function topK(items, k) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array of strings');
  }
  for (const item of items) {
    if (typeof item !== 'string') {
      throw new TypeError('items must be an array of strings');
    }
  }

  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0) {
    throw new RangeError('k must be a non-negative integer');
  }

  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  const uniqueItems = Array.from(counts.keys());

  uniqueItems.sort((a, b) => {
    const countA = counts.get(a);
    const countB = counts.get(b);
    if (countA !== countB) {
      return countB - countA;
    }
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });

  return uniqueItems.slice(0, k);
}

module.exports = { topK };
