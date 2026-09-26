'use strict';

function minCoins(coins, amount) {
  if (!Array.isArray(coins) || coins.length === 0) {
    throw new RangeError('coins must be a non-empty array');
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer');
  }

  // Validate all coin values are positive integers (handles floats, negative, zero, non-numbers, etc.)
  for (let coin of coins) {
    if (typeof coin !== 'number' || !Number.isInteger(coin) || coin <= 0) {
      throw new RangeError('coin values must be positive integers');
    }
  }

  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    for (let j = coin; j <= amount; j++) {
      dp[j] = Math.min(dp[j], dp[j - coin] + 1);
    }
  }

  return dp[amount] === Infinity ? -1 : dp[amount];
}

module.exports = { minCoins };
