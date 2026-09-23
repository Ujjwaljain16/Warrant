'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minCoins } = require('./mincoins');

function brute(coins, amount) {
  const dp = [0];
  for (let a = 1; a <= amount; a++) {
    let best = Infinity;
    for (const c of coins) if (c <= a && dp[a - c] + 1 < best) best = dp[a - c] + 1;
    dp[a] = best;
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}

test('audit: agrees with an independent dynamic programme on many systems', () => {
  const systems = [[1], [2], [2, 3], [1, 3, 4], [5, 7], [6, 10, 15], [2, 5, 10, 20], [1, 7, 10], [8, 12, 20], [3, 3, 5], [100, 1]];
  for (const coins of systems) for (let amount = 0; amount <= 60; amount++) assert.equal(minCoins(coins, amount), brute(coins, amount), `${JSON.stringify(coins)} ${amount}`);
});

test('audit: duplicates in coins are harmless and amount below every coin is impossible', () => {
  assert.equal(minCoins([5, 5, 5], 10), 2);
  assert.equal(minCoins([5, 7], 4), -1);
});

test('audit: amount 0 with any valid coins', () => {
  assert.equal(minCoins([7], 0), 0);
});
