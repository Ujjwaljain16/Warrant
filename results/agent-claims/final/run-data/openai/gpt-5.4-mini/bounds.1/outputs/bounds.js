'use strict';

function lowerBound(sorted, x) {
  if (typeof sorted !== 'object' || sorted === null || !Array.isArray(sorted) || typeof x !== 'number' || isNaN(x)) {
    throw new TypeError('Invalid input');
  }
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBound(sorted, x) {
  if (typeof sorted !== 'object' || sorted === null || !Array.isArray(sorted) || typeof x !== 'number' || isNaN(x)) {
    throw new TypeError('Invalid input');
  }
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

module.exports = { lowerBound, upperBound };
