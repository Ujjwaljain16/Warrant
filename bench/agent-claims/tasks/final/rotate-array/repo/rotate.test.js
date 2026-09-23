'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rotate } = require('./rotate');

test('rotates right', () => {
  assert.deepEqual(rotate([1, 2, 3, 4, 5], 2), [4, 5, 1, 2, 3]);
});

test('k larger than the length wraps around', () => {
  assert.deepEqual(rotate([1, 2, 3], 4), [3, 1, 2]);
});

test('k of zero', () => {
  assert.deepEqual(rotate([1, 2, 3], 0), [1, 2, 3]);
});
