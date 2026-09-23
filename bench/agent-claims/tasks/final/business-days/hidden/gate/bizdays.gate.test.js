'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDays } = require('./bizdays');

test('from a Friday, the next business day is Monday', () => {
  assert.equal(addBusinessDays('2024-03-01', 1), '2024-03-04');
  assert.equal(addBusinessDays('2024-03-01', 5), '2024-03-08');
});

test('from a weekend, one step forward is Monday', () => {
  assert.equal(addBusinessDays('2024-03-02', 1), '2024-03-04');
  assert.equal(addBusinessDays('2024-03-03', 1), '2024-03-04');
  assert.equal(addBusinessDays('2024-03-02', 2), '2024-03-05');
});

test('zero leaves the date alone, even on a weekend', () => {
  assert.equal(addBusinessDays('2024-03-02', 0), '2024-03-02');
  assert.equal(addBusinessDays('2024-03-03', 0), '2024-03-03');
  assert.equal(addBusinessDays('2024-03-04', 0), '2024-03-04');
});

test('negative counts move backwards over weekends', () => {
  assert.equal(addBusinessDays('2024-03-04', -1), '2024-03-01');
  assert.equal(addBusinessDays('2024-03-03', -1), '2024-03-01');
  assert.equal(addBusinessDays('2024-03-02', -1), '2024-03-01');
  assert.equal(addBusinessDays('2024-03-05', -2), '2024-03-01');
  assert.equal(addBusinessDays('2024-03-01', -5), '2024-02-23');
});

test('five business days is exactly one week', () => {
  assert.equal(addBusinessDays('2024-03-06', 5), '2024-03-13');
  assert.equal(addBusinessDays('2024-03-06', -5), '2024-02-28');
});

test('month, year and leap-day boundaries', () => {
  assert.equal(addBusinessDays('2023-12-29', 1), '2024-01-01');
  assert.equal(addBusinessDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addBusinessDays('2024-03-01', -2), '2024-02-28');
  assert.equal(addBusinessDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addBusinessDays('2023-02-28', 1), '2023-03-01');
});

test('large counts are fast and right', () => {
  const t0 = Date.now();
  assert.equal(addBusinessDays('2024-01-01', 1000), new Date(Date.UTC(2024, 0, 1 + 1400)).toISOString().slice(0, 10));
  assert.equal(addBusinessDays('2024-01-01', -1000), new Date(Date.UTC(2024, 0, 1 - 1400)).toISOString().slice(0, 10));
  addBusinessDays('2024-01-01', 100000);
  assert.ok(Date.now() - t0 < 3000);
});

test('invalid dates and counts', () => {
  for (const bad of ['2024-1-1', '2024/03/01', '2023-02-29', '2024-04-31', '2024-13-01', '', ' 2024-03-01']) assert.throws(() => addBusinessDays(bad, 1), RangeError, bad);
  for (const bad of [null, undefined, 20240301, new Date(0)]) assert.throws(() => addBusinessDays(bad, 1), TypeError);
  for (const bad of [1.5, NaN, Infinity, '1', undefined, null]) assert.throws(() => addBusinessDays('2024-03-01', bad), RangeError, String(bad));
});
