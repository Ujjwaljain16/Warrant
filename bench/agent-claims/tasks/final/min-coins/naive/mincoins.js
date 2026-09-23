'use strict';

function minCoins(coins, amount) {
  const sorted = [...coins].sort((a, b) => b - a);
  let left = amount;
  let count = 0;
  for (const c of sorted) {
    count += Math.floor(left / c);
    left %= c;
  }
  return left === 0 ? count : -1;
}

module.exports = { minCoins };
