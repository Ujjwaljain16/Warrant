'use strict';

function topK(items, k) {
  const counts = new Map();
  for (const s of items) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((entry) => entry[0]);
}

module.exports = { topK };
