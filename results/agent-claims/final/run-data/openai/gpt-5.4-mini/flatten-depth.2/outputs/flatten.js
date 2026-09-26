'use strict';

function flatten(items, depth = 1) {
  if (typeof items !== 'object' || items === null) {
    throw new TypeError('flatten: items must be an array');
  }
  if (!Array.isArray(items)) {
    throw new TypeError('flatten: items must be an array');
  }
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) {
    throw new RangeError('flatten: depth must be a non-negative integer or Infinity');
  }
  if (depth === 0) {
    return [...items];
  }
  const out = [];
  for (const item of items) {
    if (Array.isArray(item) && depth > 0) {
      out.push(...flatten(item, depth - 1));
    } else {
      out.push(item);
    }
  }
  return out;
}

module.exports = { flatten };
