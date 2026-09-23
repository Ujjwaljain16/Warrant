'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDays } = require('./bizdays');

test('within a week', () => {
  assert.equal(addBusinessDays('2024-01-01', 2), '2024-01-03');
});

test('over a weekend', () => {
  assert.equal(addBusinessDays('2024-01-05', 1), '2024-01-08');
});
