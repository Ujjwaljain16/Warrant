'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cronMatches } = require('./cron');

const at = (iso) => new Date(iso);

test('every field a star matches any time', () => {
  assert.equal(cronMatches('* * * * *', at('2024-03-05T10:20:00Z')), true);
});

test('minute and hour', () => {
  assert.equal(cronMatches('30 9 * * *', at('2024-03-05T09:30:00Z')), true);
  assert.equal(cronMatches('30 9 * * *', at('2024-03-05T09:31:00Z')), false);
});

test('steps and lists', () => {
  assert.equal(cronMatches('*/15 * * * *', at('2024-03-05T10:45:00Z')), true);
  assert.equal(cronMatches('0 8,12,18 * * *', at('2024-03-05T12:00:00Z')), true);
});
