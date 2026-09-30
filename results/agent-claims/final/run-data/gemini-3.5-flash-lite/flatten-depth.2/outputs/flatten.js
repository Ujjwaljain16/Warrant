'use strict';

function flatten(items, depth = 1) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }

  if (depth !== Infinity) {
    if (typeof depth !== 'number' || Number.isNaN(depth) || depth < 0 || !Number.isInteger(depth)) {
      throw new RangeError('depth must be a non-negative integer or Infinity');
    }
  }

  if (depth === 0) {
    return [...items];
  }

  const out = [];
  for (const item of items) {
    if (Array.isArray(item) && depth > 0) {
      const nextDepth = depth === Infinity ? Infinity : depth - 1;
      out.push(...flatten(item, nextDepth));
    } else {
      out.push(item);
    }
  }
  return out;
}

module.exports = { flatten };
