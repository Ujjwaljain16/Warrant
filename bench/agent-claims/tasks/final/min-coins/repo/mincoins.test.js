'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minCoins } = require('./mincoins');

test('a typical coin system', () => {
  assert.equal(minCoins([1, 2, 5], 11), 3);
  assert.equal(minCoins([1, 5, 10, 25], 63), 6);
});

test('impossible and zero amounts', () => {
  assert.equal(minCoins([2], 3), -1);
  assert.equal(minCoins([1, 2, 5], 0), 0);
});
