'use strict';

function minCoins(coins, amount) {
  if (!Array.isArray(coins) || coins.length === 0) {
    throw new RangeError('coins must be a non-empty array of positive integers');
  }
  for (const c of coins) {
    if (!Number.isInteger(c) || c <= 0) {
      throw new RangeError('coins must be a non-empty array of positive integers');
    }
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer');
  }

  // Unbounded coin change: dp[v] = fewest coins summing to v, or Infinity.
  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;
  for (let v = 1; v <= amount; v++) {
    let best = Infinity;
    for (const c of coins) {
      if (c <= v) {
        const candidate = dp[v - c] + 1;
        if (candidate < best) best = candidate;
      }
    }
    dp[v] = best;
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}

module.exports = { minCoins };
