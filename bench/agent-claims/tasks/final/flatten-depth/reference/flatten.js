'use strict';

function flatten(items, depth = 1) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (depth !== Infinity && (!Number.isInteger(depth) || depth < 0)) throw new RangeError('depth must be a non-negative integer or Infinity');
  const out = [];
  const walk = (list, remaining) => {
    for (const item of list) {
      if (Array.isArray(item) && remaining > 0) walk(item, remaining - 1);
      else out.push(item);
    }
  };
  walk(items, depth);
  return out;
}

module.exports = { flatten };
