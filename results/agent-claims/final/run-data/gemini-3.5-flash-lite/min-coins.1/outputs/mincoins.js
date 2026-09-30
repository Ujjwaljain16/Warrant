'use strict';

function minCoins(coins, amount) {
  if (!Array.isArray(coins) || coins.length === 0) {
    throw new RangeError('Coins must be a non-empty array');
  }
  for (const c of coins) {
    if (!Number.isInteger(c) || c <= 0) {
      throw new RangeError('Coins must be positive integers');
    }
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('Amount must be a non-negative integer');
  }

  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;

  for (let i = 1; i <= amount; i++) {
    for (const c of coins) {
      if (i - c >= 0 && dp[i - c] + 1 < dp[i]) {
        dp[i] = dp[i - c] + 1;
      }
    }
  }

  return dp[amount] === Infinity ? -1 : dp[amount];
}

module.exports = { minCoins };
