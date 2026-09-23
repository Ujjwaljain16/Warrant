'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals } = require('./intervals');

test('merges overlapping intervals', () => {
  assert.deepEqual(mergeIntervals([[1, 3], [2, 6], [8, 10]]), [[1, 6], [8, 10]]);
});

test('sorts unsorted input', () => {
  assert.deepEqual(mergeIntervals([[8, 10], [1, 3], [2, 6]]), [[1, 6], [8, 10]]);
});
