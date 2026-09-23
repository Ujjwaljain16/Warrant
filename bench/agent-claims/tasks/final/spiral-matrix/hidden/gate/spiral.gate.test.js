'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spiral } = require('./spiral');

test('a single row', () => {
  assert.deepEqual(spiral([[1, 2, 3, 4]]), [1, 2, 3, 4]);
  assert.deepEqual(spiral([[7]]), [7]);
});

test('a single column', () => {
  assert.deepEqual(spiral([[1], [2], [3]]), [1, 2, 3]);
});

test('wide and tall rectangles', () => {
  assert.deepEqual(spiral([[1, 2, 3], [4, 5, 6]]), [1, 2, 3, 6, 5, 4]);
  assert.deepEqual(spiral([[1, 2], [3, 4], [5, 6]]), [1, 2, 4, 6, 5, 3]);
  assert.deepEqual(spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]), [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7]);
  assert.deepEqual(spiral([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]), [1, 2, 3, 6, 9, 12, 11, 10, 7, 4, 5, 8]);
});

test('a 4 x 4 matrix', () => {
  const m = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]];
  assert.deepEqual(spiral(m), [1, 2, 3, 4, 8, 12, 16, 15, 14, 13, 9, 5, 6, 7, 11, 10]);
});

test('empty matrices', () => {
  assert.deepEqual(spiral([]), []);
  assert.deepEqual(spiral([[]]), []);
});

test('ragged or non-array input is a TypeError', () => {
  for (const bad of [[[1, 2], [3]], [[1], [2, 3]], [1, 2], null, undefined, 'abc', [[1, 2], 'ab']]) assert.throws(() => spiral(bad), TypeError, JSON.stringify(bad));
});

test('the input is not modified', () => {
  const m = [[1, 2, 3], [4, 5, 6]];
  spiral(m);
  assert.deepEqual(m, [[1, 2, 3], [4, 5, 6]]);
});
