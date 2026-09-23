'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile } = require('./percentile');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);

test('values are sorted numerically, not as text', () => {
  assert.equal(percentile([10, 9, 100, 2], 0), 2);
  assert.equal(percentile([10, 9, 100, 2], 100), 100);
  close(percentile([10, 9, 100, 2], 50), 9.5);
  assert.equal(percentile([1, 11, 2, 22, 3], 50), 3);
});

test('interpolation at other ranks', () => {
  close(percentile([1, 2, 3, 4], 25), 1.75);
  close(percentile([1, 2, 3, 4], 75), 3.25);
  close(percentile([10, 20], 10), 11);
  close(percentile([0, 100], 33), 33);
});

test('negative numbers and duplicates', () => {
  close(percentile([-5, -1, -3], 50), -3);
  close(percentile([2, 2, 2, 2], 40), 2);
  close(percentile([-10, 10], 50), 0);
});

test('a single value is every percentile', () => {
  for (const p of [0, 1, 50, 99.5, 100]) assert.equal(percentile([7], p), 7);
});

test('the input is not modified', () => {
  const input = [3, 1, 2];
  percentile(input, 50);
  assert.deepEqual(input, [3, 1, 2]);
});

test('invalid p and values', () => {
  for (const bad of [-1, 100.5, NaN, Infinity, '50', undefined, null]) assert.throws(() => percentile([1, 2], bad), RangeError, String(bad));
  for (const bad of [[], 'abc', null, undefined]) assert.throws(() => percentile(bad, 50), RangeError);
  for (const bad of [[1, '2'], [1, NaN], [1, Infinity], [1, null]]) assert.throws(() => percentile(bad, 50), TypeError);
});
