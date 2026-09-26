'use strict';

function topK(items, k) {
  // Validate k
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError('k must be a non-negative integer');
  }

  // Validate items
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  for (const item of items) {
    if (typeof item !== 'string') {
      throw new TypeError('items must be an array of strings');
    }
  }

  // Count frequencies
  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  // Sort by count (descending), then alphabetically
  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (a[1] !== b[1]) {
      return b[1] - a[1];
    }
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  // Return top k
  return sorted.slice(0, k).map(entry => entry[0]);
}

module.exports = { topK };
