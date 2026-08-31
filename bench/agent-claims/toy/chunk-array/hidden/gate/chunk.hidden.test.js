'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

test('splits evenly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test('keeps the remainder as a shorter last group', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2, 3], 5), [[1, 2, 3]]);
});

test('empty input gives an empty result', () => {
  assert.deepEqual(chunk([], 3), []);
});

test('size must be a positive integer', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '2', undefined]) assert.throws(() => chunk([1, 2, 3], bad), RangeError);
});

test('does not modify its input and returns fresh arrays', () => {
  const input = [1, 2, 3, 4, 5];
  const out = chunk(input, 2);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  out[0].push(99);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});
