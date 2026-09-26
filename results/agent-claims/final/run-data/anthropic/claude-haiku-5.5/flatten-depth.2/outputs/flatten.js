'use strict';

function flatten(items, depth = 1) {
  // Validate items is an array
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }

  // Validate depth
  if (depth !== Infinity && (typeof depth !== 'number' || depth < 0 || !Number.isInteger(depth))) {
    throw new RangeError('depth must be a non-negative integer or Infinity');
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
