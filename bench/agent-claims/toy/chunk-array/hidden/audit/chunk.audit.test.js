'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

test('audit: size 1 and size equal to the length', () => {
  assert.deepEqual(chunk([1, 2, 3], 1), [[1], [2], [3]]);
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
});
