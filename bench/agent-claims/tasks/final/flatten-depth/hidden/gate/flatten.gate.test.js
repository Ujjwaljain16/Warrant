'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { flatten } = require('./flatten');

test('the default depth is exactly one', () => {
  assert.deepEqual(flatten([1, [2, [3, [4]]]]), [1, 2, [3, [4]]]);
});

test('a given depth stops at that level', () => {
  assert.deepEqual(flatten([1, [2, [3, [4]]]], 2), [1, 2, 3, [4]]);
  assert.deepEqual(flatten([1, [2, [3, [4]]]], 3), [1, 2, 3, 4]);
  assert.deepEqual(flatten([[[1]], [[2]]], 1), [[1], [2]]);
});

test('depth 0 is a shallow copy', () => {
  const inner = [2];
  const input = [1, inner];
  const out = flatten(input, 0);
  assert.deepEqual(out, [1, [2]]);
  assert.notEqual(out, input);
  assert.equal(out[1], inner);
});

test('nested arrays beyond the depth are the same objects', () => {
  const deep = [3];
  const out = flatten([1, [2, deep]], 1);
  assert.equal(out[2], deep);
});

test('null and undefined are kept; empty arrays vanish when flattened', () => {
  assert.deepEqual(flatten([null, [undefined, []], []]), [null, undefined, []]);
  assert.deepEqual(flatten([[], [[]]], Infinity), []);
});

test('invalid depth is a RangeError', () => {
  for (const bad of [-1, 1.5, NaN, -Infinity, '1', null]) assert.throws(() => flatten([1], bad), RangeError, String(bad));
});

test('items must be an array', () => {
  for (const bad of ['abc', null, undefined, { length: 1, 0: 1 }]) assert.throws(() => flatten(bad), TypeError);
});

test('the input is never modified', () => {
  const input = [1, [2, [3]]];
  const snapshot = JSON.stringify(input);
  flatten(input, Infinity);
  flatten(input, 1);
  assert.equal(JSON.stringify(input), snapshot);
});
