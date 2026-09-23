'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile } = require('./percentile');

test('median of an odd list', () => {
  assert.equal(percentile([5, 3, 1, 4, 2], 50), 3);
});

test('the ends', () => {
  assert.equal(percentile([4, 2, 9, 1], 0), 1);
  assert.equal(percentile([4, 2, 9, 1], 100), 9);
});

test('interpolation', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
});
