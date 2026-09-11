'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

test('keeps the last, shorter piece', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('size larger than the list gives one piece', () => {
  assert.deepEqual(chunk([1, 2], 5), [[1, 2]]);
});

test('empty input gives no pieces', () => {
  assert.deepEqual(chunk([], 3), []);
});

test('the input is not modified', () => {
  const input = [1, 2, 3];
  const out = chunk(input, 2);
  assert.deepEqual(input, [1, 2, 3]);
  out[0].push(99);
  assert.deepEqual(input, [1, 2, 3]);
});

test('an invalid size is a RangeError', () => {
  for (const size of [0, -1, 1.5, NaN, '2']) assert.throws(() => chunk([1, 2, 3], size), RangeError);
});

test('a non-array is a TypeError', () => {
  assert.throws(() => chunk('abc', 2), TypeError);
});
