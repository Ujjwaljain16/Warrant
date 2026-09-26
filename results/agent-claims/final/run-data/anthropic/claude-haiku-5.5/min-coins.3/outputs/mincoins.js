'use strict';

function minCoins(coins, amount) {
  // Validate inputs
  if (!Array.isArray(coins) || coins.length === 0) {
    throw new RangeError('coins must be a non-empty array');
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer');
  }
  for (const coin of coins) {
    if (!Number.isInteger(coin) || coin <= 0) {
      throw new RangeError('all coin values must be positive integers');
    }
  }

  // Base case: zero amount requires zero coins
  if (amount === 0) return 0;

  // Dynamic programming: dp[i] = minimum coins needed for amount i
  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;

  for (let i = 1; i <= amount; i++) {
    for (const coin of coins) {
      if (coin <= i && dp[i - coin] !== Infinity) {
        dp[i] = Math.min(dp[i], dp[i - coin] + 1);
      }
    }
  }

  return dp[amount] === Infinity ? -1 : dp[amount];
}

module.exports = { minCoins };
