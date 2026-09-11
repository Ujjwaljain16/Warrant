'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

test('size one gives single-item pieces', () => {
  assert.deepEqual(chunk(['a', 'b'], 1), [['a'], ['b']]);
});

test('works for nested arrays', () => {
  assert.deepEqual(chunk([[1], [2], [3]], 2), [[[1], [2]], [[3]]]);
});
