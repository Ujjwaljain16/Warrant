'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDays } = require('./bizdays');

const weekday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();

test('audit: the result of a nonzero step count is always a weekday', () => {
  for (const start of ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04']) {
    for (let n = -12; n <= 12; n++) {
      if (n === 0) continue;
      const out = addBusinessDays(start, n);
      assert.ok(weekday(out) >= 1 && weekday(out) <= 5, `${start} ${n} -> ${out}`);
    }
  }
});

test('audit: adding n then -n returns to the start when the start is a weekday', () => {
  for (let n = 1; n <= 30; n++) assert.equal(addBusinessDays(addBusinessDays('2024-03-06', n), -n), '2024-03-06');
});

test('audit: stepping one at a time equals stepping all at once', () => {
  let d = '2024-02-23';
  for (let i = 1; i <= 25; i++) {
    d = addBusinessDays(d, 1);
    assert.equal(d, addBusinessDays('2024-02-23', i));
  }
});

test('audit: results outside years 1000-9999 are a RangeError', () => {
  assert.throws(() => addBusinessDays('9999-12-31', 1), RangeError);
  assert.throws(() => addBusinessDays('1000-01-01', -1), RangeError);
  assert.throws(() => addBusinessDays('0999-12-31', 0), RangeError);
});

test('audit: a year-end Friday', () => {
  assert.equal(addBusinessDays('2021-12-31', 1), '2022-01-03');
});
