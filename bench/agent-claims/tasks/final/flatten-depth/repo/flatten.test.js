'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { flatten } = require('./flatten');

test('flattens one level by default', () => {
  assert.deepEqual(flatten([1, [2, 3], 4]), [1, 2, 3, 4]);
});

test('Infinity flattens everything', () => {
  assert.deepEqual(flatten([1, [2, [3, [4]]]], Infinity), [1, 2, 3, 4]);
});
