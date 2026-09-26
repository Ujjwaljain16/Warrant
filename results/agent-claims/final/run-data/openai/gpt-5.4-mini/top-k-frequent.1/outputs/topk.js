'use strict';

function topK(_items, _k) {
  if (typeof _k !== 'number' || !Number.isInteger(_k) || _k < 0) {
    throw new RangeError('k must be a non-negative integer');
  }
  if (!Array.isArray(_items)) {
    throw new TypeError('items must be an array');
  }
  if (_items.length === 0) {
    return [];
  }

  const map = new Map();
  for (const item of _items) {
    if (typeof item !== 'string') {
      throw new TypeError('items must be an array of strings');
    }
    map.set(item, (map.get(item) || 0) + 1);
  }

  const entries = Array.from(map.entries());

  entries.sort((a, b) => {
    const countDiff = b[1] - a[1];
    if (countDiff !== 0) {
      return countDiff;
    }
    return a[0].localeCompare(b[0]);
  });

  const result = entries.map(entry => entry[0]);

  if (result.length > _k) {
    return result.slice(0, _k);
  }
  return result;
}

module.exports = { topK };