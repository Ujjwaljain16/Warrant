'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween } = require('./daysbetween');

test('counts both end days', () => {
  assert.equal(daysBetween('2024-01-01', '2024-01-10'), 10);
});

test('a single day', () => {
  assert.equal(daysBetween('2024-05-05', '2024-05-05'), 1);
});
