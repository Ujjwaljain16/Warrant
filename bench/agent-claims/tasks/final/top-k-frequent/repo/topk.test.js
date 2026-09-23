'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topK } = require('./topk');

test('most frequent first', () => {
  assert.deepEqual(topK(['b', 'a', 'b', 'c', 'a', 'b'], 2), ['b', 'a']);
});

test('k larger than the number of distinct strings', () => {
  assert.deepEqual(topK(['x', 'y', 'x'], 5), ['x', 'y']);
});
