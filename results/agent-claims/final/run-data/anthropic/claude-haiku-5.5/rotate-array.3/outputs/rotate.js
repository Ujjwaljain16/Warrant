'use strict';

function rotate(items, k) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  
  if (!Number.isInteger(k)) {
    throw new RangeError('k must be an integer');
  }
  
  const n = items.length;
  if (n === 0) {
    return [];
  }
  
  const normalizedK = ((k % n) + n) % n;
  
  if (normalizedK === 0) {
    return [...items];
  }
  
  return [...items.slice(-normalizedK), ...items.slice(0, n - normalizedK)];
}

module.exports = { rotate };
