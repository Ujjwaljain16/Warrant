'use strict';

function minCoins(coins, amount) {
  if (!Array.isArray(coins) || coins.length === 0 || !coins.every(c => Number.isInteger(c) && c > 0)) {
    throw new RangeError('coins must be a non-empty array of positive integers');
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer');
  }

  if (amount === 0) return 0;

  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;

  for (let i = 1; i <= amount; i++) {
    for (const coin of coins) {
      if (coin <= i) {
        dp[i] = Math.min(dp[i], dp[i - coin] + 1);
      }
    }
  }

  return dp[amount] === Infinity ? -1 : dp[amount];
}

module.exports = { minCoins };
