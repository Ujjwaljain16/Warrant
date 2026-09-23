'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween } = require('./daysbetween');

test('audit: century years', () => {
  assert.equal(daysBetween('1900-02-28', '1900-03-01'), 2);
  assert.equal(daysBetween('2000-02-28', '2000-03-01'), 3);
  assert.equal(daysBetween('2100-02-28', '2100-03-01'), 2);
});

test('audit: 1900-02-29 and 2100-02-29 do not exist, 2000-02-29 does', () => {
  assert.throws(() => daysBetween('1900-02-29', '1900-03-01'), RangeError);
  assert.throws(() => daysBetween('2100-02-29', '2100-03-01'), RangeError);
  assert.equal(daysBetween('2000-02-29', '2000-02-29'), 1);
});

test('audit: a long span', () => {
  assert.equal(daysBetween('2000-01-01', '2099-12-31'), 36525);
});

test('audit: month ends', () => {
  assert.equal(daysBetween('2024-01-31', '2024-02-01'), 2);
  assert.equal(daysBetween('2024-04-30', '2024-05-01'), 2);
  assert.throws(() => daysBetween('2024-06-31', '2024-07-01'), RangeError);
});
