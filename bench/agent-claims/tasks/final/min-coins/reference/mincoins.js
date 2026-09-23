'use strict';

function minCoins(coins, amount) {
  if (!Array.isArray(coins) || coins.length === 0 || !coins.every((c) => Number.isInteger(c) && c > 0)) throw new RangeError('coins must be a non-empty array of positive integers');
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('amount must be a non-negative integer');
  const best = new Array(amount + 1).fill(Infinity);
  best[0] = 0;
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c <= a && best[a - c] + 1 < best[a]) best[a] = best[a - c] + 1;
    }
  }
  return best[amount] === Infinity ? -1 : best[amount];
}

module.exports = { minCoins };
