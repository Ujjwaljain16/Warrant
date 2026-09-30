'use strict';

function validate(sorted, x) {
  if (!Array.isArray(sorted) || typeof x !== 'number' || Number.isNaN(x)) {
    throw new TypeError('Invalid arguments');
  }
}

function lowerBound(sorted, x) {
  validate(sorted, x);
  let lo = 0;
  let hi = sorted.length;
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
  validate(sorted, x);
  let lo = 0;
  let hi = sorted.length;
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
