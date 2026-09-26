'use strict';

function rotate(items, k) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  
  if (!Number.isInteger(k)) {
    throw new RangeError('k must be an integer');
  }
  
  const length = items.length;
  if (length === 0) {
    return [];
  }
  
  // Normalize k to handle wrapping and negative values
  const normalizedK = ((k % length) + length) % length;
  
  // Create new array with items rotated right by normalizedK positions
  if (normalizedK === 0) {
    return items.slice();
  }
  
  return items.slice(-normalizedK).concat(items.slice(0, -normalizedK));
}

module.exports = { rotate };
