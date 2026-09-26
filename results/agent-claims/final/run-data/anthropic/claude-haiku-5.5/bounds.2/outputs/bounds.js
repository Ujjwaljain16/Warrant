'use strict';

function lowerBound(sorted, x) {
  if (!Array.isArray(sorted)) {
    throw new TypeError('sorted must be an array');
  }
  if (typeof x !== 'number' || Number.isNaN(x)) {
    throw new TypeError('x must be a number and not NaN');
  }
  
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted, x) {
  if (!Array.isArray(sorted)) {
    throw new TypeError('sorted must be an array');
  }
  if (typeof x !== 'number' || Number.isNaN(x)) {
    throw new TypeError('x must be a number and not NaN');
  }
  
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

module.exports = { lowerBound, upperBound };
