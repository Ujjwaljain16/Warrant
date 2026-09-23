'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topK } = require('./topk');

test('ties are broken alphabetically', () => {
  assert.deepEqual(topK(['b', 'a', 'b', 'a', 'c'], 2), ['a', 'b']);
  assert.deepEqual(topK(['z', 'y', 'x'], 3), ['x', 'y', 'z']);
  assert.deepEqual(topK(['z', 'y', 'x'], 2), ['x', 'y']);
});

test('code unit order, not locale order', () => {
  assert.deepEqual(topK(['a', 'B'], 2), ['B', 'a']);
  assert.deepEqual(topK(['b', 'a', 'A'], 3), ['A', 'a', 'b']);
});

test('counts dominate the tie-break', () => {
  assert.deepEqual(topK(['d', 'c', 'c', 'b', 'b', 'a'], 3), ['b', 'c', 'a']);
});

test('k of zero and empty input', () => {
  assert.deepEqual(topK(['a', 'a'], 0), []);
  assert.deepEqual(topK([], 3), []);
});

test('the input is not modified', () => {
  const input = ['b', 'a', 'b'];
  topK(input, 1);
  assert.deepEqual(input, ['b', 'a', 'b']);
});

test('argument checks', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '2', undefined]) assert.throws(() => topK(['a'], bad), RangeError, String(bad));
  for (const bad of [null, 'abc', undefined, [1, 2], ['a', null]]) assert.throws(() => topK(bad, 1), TypeError);
});
