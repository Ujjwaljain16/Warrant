'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween } = require('./daysbetween');

test('leap days count', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 3);
  assert.equal(daysBetween('2023-02-28', '2023-03-01'), 2);
  assert.equal(daysBetween('2024-02-29', '2024-02-29'), 1);
});

test('spans across months and years', () => {
  assert.equal(daysBetween('2023-12-31', '2024-01-01'), 2);
  assert.equal(daysBetween('2023-01-01', '2023-12-31'), 365);
  assert.equal(daysBetween('2024-01-01', '2024-12-31'), 366);
});

test('an earlier end date is a RangeError', () => {
  assert.throws(() => daysBetween('2024-01-02', '2024-01-01'), RangeError);
});

test('malformed or impossible dates are a RangeError', () => {
  for (const bad of ['2024-1-1', '2024/01/01', ' 2024-01-01', '2024-01-01 ', '20240101', '2024-01-011', '2023-02-29', '2024-04-31', '2024-00-10', '2024-13-01', '2024-01-00', 'today', '']) {
    assert.throws(() => daysBetween(bad, '2025-01-01'), RangeError, bad);
    assert.throws(() => daysBetween('2020-01-01', bad), RangeError, bad);
  }
});

test('non-strings are a TypeError', () => {
  for (const bad of [null, undefined, 20240101, new Date(0)]) {
    assert.throws(() => daysBetween(bad, '2024-01-01'), TypeError);
    assert.throws(() => daysBetween('2024-01-01', bad), TypeError);
  }
});
