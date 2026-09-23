'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minCoins } = require('./mincoins');

test('systems where the greedy choice is wrong', () => {
  assert.equal(minCoins([1, 3, 4], 6), 2);
  assert.equal(minCoins([1, 5, 6, 9], 11), 2);
  assert.equal(minCoins([4, 1, 3], 6), 2);
  assert.equal(minCoins([9, 6, 5, 1], 11), 2);
});

test('unreachable amounts', () => {
  assert.equal(minCoins([7, 3], 11), -1);
  assert.equal(minCoins([5, 10], 3), -1);
  assert.equal(minCoins([4, 6], 7), -1);
});

test('a coin of 1 makes every amount reachable', () => {
  assert.equal(minCoins([1], 5), 5);
  assert.equal(minCoins([1, 2], 7), 4);
});

test('large amounts are fast and right', () => {
  assert.equal(minCoins([1, 5, 10, 25], 10000), 400);
  assert.equal(minCoins([3, 7, 11], 9999), brute([3, 7, 11], 9999));
});

test('invalid arguments throw RangeError', () => {
  for (const bad of [[], [0], [-1, 2], [1.5], ['1'], [1, NaN], 'abc', null, undefined]) assert.throws(() => minCoins(bad, 5), RangeError, JSON.stringify(bad));
  for (const bad of [-1, 1.5, NaN, Infinity, '5', undefined, null]) assert.throws(() => minCoins([1, 2], bad), RangeError, String(bad));
});

test('the coins array is not modified', () => {
  const coins = [5, 1, 3];
  minCoins(coins, 7);
  assert.deepEqual(coins, [5, 1, 3]);
});

function brute(coins, amount) {
  const dp = [0];
  for (let a = 1; a <= amount; a++) {
    let best = Infinity;
    for (const c of coins) if (c <= a && dp[a - c] + 1 < best) best = dp[a - c] + 1;
    dp[a] = best;
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}
