'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rotate } = require('./rotate');

test('negative k rotates left', () => {
  assert.deepEqual(rotate([1, 2, 3, 4, 5], -1), [2, 3, 4, 5, 1]);
  assert.deepEqual(rotate([1, 2, 3, 4, 5], -2), [3, 4, 5, 1, 2]);
  assert.deepEqual(rotate([1, 2, 3, 4, 5], -7), [3, 4, 5, 1, 2]);
});

test('rotating by a multiple of the length changes nothing', () => {
  assert.deepEqual(rotate([1, 2, 3], 3), [1, 2, 3]);
  assert.deepEqual(rotate([1, 2, 3], 6), [1, 2, 3]);
  assert.deepEqual(rotate([1, 2, 3], -3), [1, 2, 3]);
});

test('empty and single-item arrays', () => {
  assert.deepEqual(rotate([], 3), []);
  assert.deepEqual(rotate([], -3), []);
  assert.deepEqual(rotate(['x'], 5), ['x']);
  assert.deepEqual(rotate(['x'], -5), ['x']);
});

test('the result is always a new array and the input is unchanged', () => {
  const input = [1, 2, 3];
  assert.notEqual(rotate(input, 0), input);
  assert.notEqual(rotate(input, 3), input);
  rotate(input, 1);
  assert.deepEqual(input, [1, 2, 3]);
});

test('k must be an integer', () => {
  for (const bad of [1.5, NaN, Infinity, '1', undefined, null]) assert.throws(() => rotate([1, 2, 3], bad), RangeError, String(bad));
});

test('items must be an array', () => {
  for (const bad of ['abc', null, undefined, {}]) assert.throws(() => rotate(bad, 1), TypeError);
});
