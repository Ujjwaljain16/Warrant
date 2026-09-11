'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

test('splits evenly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test('keeps the last, shorter piece', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
