'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lowerBound, upperBound } = require('./bounds');

test('a value in the middle of distinct numbers', () => {
  assert.equal(lowerBound([1, 3, 5, 7, 9], 5), 2);
  assert.equal(upperBound([1, 3, 5, 7, 9], 5), 3);
});

test('a value between two elements', () => {
  assert.equal(lowerBound([1, 3, 5, 7, 9], 4), 2);
  assert.equal(upperBound([1, 3, 5, 7, 9], 4), 2);
});
