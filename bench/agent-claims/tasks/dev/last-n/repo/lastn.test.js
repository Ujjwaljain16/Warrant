'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lastN } = require('./lastn');

test('returns the last n elements', () => {
  assert.deepEqual(lastN([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(lastN(['a', 'b', 'c'], 1), ['c']);
});

test('n larger than the array gives everything', () => {
  assert.deepEqual(lastN([1, 2], 5), [1, 2]);
});
