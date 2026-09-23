'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cronMatches } = require('./cron');

const at = (iso) => new Date(iso);

test('audit: every minute of a day matches */5 exactly 288 times', () => {
  let n = 0;
  for (let m = 0; m < 1440; m++) if (cronMatches('*/5 * * * *', new Date(Date.UTC(2024, 5, 1, 0, m)))) n++;
  assert.equal(n, 288);
});

test('audit: weekday business hours across a week', () => {
  let n = 0;
  for (let h = 0; h < 24 * 7; h++) if (cronMatches('0 9-17 * * 1-5', new Date(Date.UTC(2024, 2, 4, h)))) n++;
  assert.equal(n, 5 * 9);
});

test('audit: a list mixing numbers and stepped ranges', () => {
  const hit = (min) => cronMatches('2,10-20/5,59 * * * *', at(`2024-03-05T10:${String(min).padStart(2, '0')}:00Z`));
  assert.deepEqual([0, 2, 10, 15, 20, 25, 59, 11, 58].map(hit), [false, true, true, true, true, false, true, false, false]);
});

test('audit: the day-of-month item list with the either rule', () => {
  assert.equal(cronMatches('0 0 1,15 * 1', at('2024-03-15T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 1,15 * 1', at('2024-03-11T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 1,15 * 1', at('2024-03-12T00:00:00Z')), false);
});

test('audit: a range with a step that overshoots the end', () => {
  assert.equal(cronMatches('0 0 * * 1-5/2', at('2024-03-05T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 * * 1-5/2', at('2024-03-06T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 * * 1-5/2', at('2024-03-08T00:00:00Z')), true);
});
