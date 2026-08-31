'use strict';

// Sum of the integers from a to b, both included; 0 when a > b.
function sumRange(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new TypeError('a and b must be integers');
  if (a > b) return 0;
  let total = 0;
  for (let i = a; i <= b; i++) total += i;
  return total;
}

module.exports = { sumRange };
