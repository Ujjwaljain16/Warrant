'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile } = require('./percentile');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

test('audit: p given as exactly 0 and 100 on unsorted multi-digit data', () => {
  assert.equal(percentile([1000, 20, 3, 400], 0), 3);
  assert.equal(percentile([1000, 20, 3, 400], 100), 1000);
});

test('audit: fractional values and fractional p', () => {
  close(percentile([0.5, 1.5, 2.5], 25), 1);
  close(percentile([1, 2, 3, 4, 5], 12.5), 1.5);
});

test('audit: the median of an even count of multi-digit numbers', () => {
  close(percentile([100, 20, 3, 4000], 50), 60);
});

test('audit: large p near the top', () => {
  close(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
});
