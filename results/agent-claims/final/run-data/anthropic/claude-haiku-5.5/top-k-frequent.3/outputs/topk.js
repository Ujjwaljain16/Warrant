'use strict';

function topK(items, k) {
  // Validate inputs
  if (typeof k !== 'number' || k < 0 || !Number.isInteger(k)) {
    throw new RangeError('k must be a non-negative integer');
  }

  if (!Array.isArray(items) || !items.every(item => typeof item === 'string')) {
    throw new TypeError('items must be an array of strings');
  }

  // Count frequencies
  const frequency = {};
  for (const item of items) {
    frequency[item] = (frequency[item] || 0) + 1;
  }

  // Get unique items with their counts
  const entries = Object.entries(frequency);

  // Sort by count (descending), then alphabetically (ascending)
  entries.sort((a, b) => {
    if (a[1] !== b[1]) {
      return b[1] - a[1]; // Higher count first
    }
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // Alphabetical order
  });

  // Return top k items
  return entries.slice(0, k).map(entry => entry[0]);
}

module.exports = { topK };
