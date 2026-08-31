'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sumRange } = require('./sumrange');

test('inclusive of both ends', () => {
  assert.equal(sumRange(1, 4), 10);
  assert.equal(sumRange(1, 100), 5050);
});

test('a single-element range', () => {
  assert.equal(sumRange(7, 7), 7);
  assert.equal(sumRange(0, 0), 0);
});

test('negative numbers', () => {
  assert.equal(sumRange(-2, 2), 0);
  assert.equal(sumRange(-5, -3), -12);
});

test('an empty range (a > b) is 0', () => {
  assert.equal(sumRange(5, 1), 0);
});

test('non-integers throw TypeError', () => {
  for (const bad of [1.5, NaN, Infinity, '3', null, undefined]) {
    assert.throws(() => sumRange(bad, 4), TypeError);
    assert.throws(() => sumRange(1, bad), TypeError);
  }
});
