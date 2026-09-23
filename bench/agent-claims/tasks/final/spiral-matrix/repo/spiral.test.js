'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spiral } = require('./spiral');

test('a 3 x 3 matrix', () => {
  assert.deepEqual(spiral([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), [1, 2, 3, 6, 9, 8, 7, 4, 5]);
});

test('a 2 x 2 matrix', () => {
  assert.deepEqual(spiral([[1, 2], [3, 4]]), [1, 2, 4, 3]);
});
