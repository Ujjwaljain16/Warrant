'use strict';

function rotate(items, k) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (typeof k !== 'number' || !Number.isInteger(k)) {
    throw new RangeError('k must be an integer');
  }

  const len = items.length;
  if (len === 0) {
    return [];
  }

  // Normalize k
  let effectiveK = k % len;
  if (effectiveK < 0) {
    effectiveK += len;
  }

  if (effectiveK === 0) {
    return [...items];
  }

  // Last effectiveK items move to the front
  const splitIndex = len - effectiveK;
  return items.slice(splitIndex).concat(items.slice(0, splitIndex));
}

module.exports = { rotate };
