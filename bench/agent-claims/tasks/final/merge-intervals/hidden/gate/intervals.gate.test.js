'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals } = require('./intervals');

test('touching intervals merge', () => {
  assert.deepEqual(mergeIntervals([[1, 2], [2, 3]]), [[1, 3]]);
  assert.deepEqual(mergeIntervals([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);
  assert.deepEqual(mergeIntervals([[5, 6], [1, 5], [6, 9]]), [[1, 9]]);
});

test('a contained interval does not shrink the end', () => {
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3]]), [[1, 10]]);
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3], [4, 5], [9, 12]]), [[1, 12]]);
});

test('sorting is numeric', () => {
  assert.deepEqual(mergeIntervals([[10, 12], [9, 11], [100, 101]]), [[9, 12], [100, 101]]);
  assert.deepEqual(mergeIntervals([[20, 30], [3, 4]]), [[3, 4], [20, 30]]);
});

test('negative numbers, duplicates and single intervals', () => {
  assert.deepEqual(mergeIntervals([[-5, -1], [-3, 2]]), [[-5, 2]]);
  assert.deepEqual(mergeIntervals([[1, 2], [1, 2], [1, 2]]), [[1, 2]]);
  assert.deepEqual(mergeIntervals([[4, 4]]), [[4, 4]]);
  assert.deepEqual(mergeIntervals([]), []);
});

test('the input is untouched and the result is made of new arrays', () => {
  const input = [[3, 4], [1, 2], [2, 3]];
  const snapshot = JSON.stringify(input);
  const out = mergeIntervals(input);
  assert.equal(JSON.stringify(input), snapshot);
  out[0][1] = 999;
  assert.equal(JSON.stringify(input), snapshot);
  const single = [[1, 2]];
  const out2 = mergeIntervals(single);
  assert.notEqual(out2[0], single[0]);
});

test('invalid intervals', () => {
  for (const bad of [[[2, 1]], [[1]], [[1, 2, 3]], [['a', 'b']], [[NaN, 1]], [[1, Infinity]], [null], [5], [[1, 2], [4, 3]]]) assert.throws(() => mergeIntervals(bad), RangeError, JSON.stringify(bad));
  for (const bad of [null, undefined, 'abc', {}]) assert.throws(() => mergeIntervals(bad), TypeError);
});
