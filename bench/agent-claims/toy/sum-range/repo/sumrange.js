'use strict';

// Sum of the integers from a to b.
function sumRange(a, b) {
  let total = 0;
  for (let i = a; i < b; i++) total += i;
  return total;
}

module.exports = { sumRange };
