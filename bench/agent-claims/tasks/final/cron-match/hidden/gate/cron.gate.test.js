'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cronMatches } = require('./cron');

const at = (iso) => new Date(iso);

test('ranges, lists and steps over ranges', () => {
  assert.equal(cronMatches('10-40/10 * * * *', at('2024-03-05T10:30:00Z')), true);
  assert.equal(cronMatches('10-40/10 * * * *', at('2024-03-05T10:35:00Z')), false);
  assert.equal(cronMatches('10-40/10 * * * *', at('2024-03-05T10:50:00Z')), false);
  assert.equal(cronMatches('0 9-17 * * *', at('2024-03-05T17:00:00Z')), true);
  assert.equal(cronMatches('0 9-17 * * *', at('2024-03-05T18:00:00Z')), false);
  assert.equal(cronMatches('1,2,3-5 * * * *', at('2024-03-05T00:04:00Z')), true);
});

test('a star step starts at the first value of the field, which is 1 for day and month', () => {
  assert.equal(cronMatches('0 0 */10 * *', at('2024-03-11T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 */10 * *', at('2024-03-10T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 1 */3 *', at('2024-04-01T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 1 */3 *', at('2024-03-01T00:00:00Z')), false);
});

test('day of week: 0 is Sunday and weekdays are 1-5', () => {
  assert.equal(cronMatches('0 9 * * 0', at('2024-03-03T09:00:00Z')), true);
  assert.equal(cronMatches('0 9 * * 1-5', at('2024-03-04T09:00:00Z')), true);
  assert.equal(cronMatches('0 9 * * 1-5', at('2024-03-03T09:00:00Z')), false);
  assert.equal(cronMatches('0 9 * * 6', at('2024-03-02T09:00:00Z')), true);
});

test('both day fields restricted: either may match', () => {
  assert.equal(cronMatches('0 0 13 * 5', at('2024-09-13T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 13 * 5', at('2024-09-06T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 13 * 5', at('2024-09-10T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 13 * 5', at('2024-03-13T00:00:00Z')), true);
});

test('a star-led day field means both fields must match', () => {
  assert.equal(cronMatches('0 0 */2 * 5', at('2024-09-13T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 */2 * 5', at('2024-09-06T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 */2 * 5', at('2024-09-05T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 13 * *', at('2024-09-06T00:00:00Z')), false);
  assert.equal(cronMatches('0 0 * * *', at('2024-09-06T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 15 * */2', at('2024-09-15T00:00:00Z')), true);
  assert.equal(cronMatches('0 0 15 * */2', at('2024-09-14T00:00:00Z')), false);
});

test('the time zone is UTC', () => {
  assert.equal(cronMatches('30 23 31 12 *', at('2024-12-31T23:30:00Z')), true);
  assert.equal(cronMatches('0 0 1 1 *', at('2024-01-01T00:00:59Z')), true);
});

test('extra whitespace and leading zeros', () => {
  assert.equal(cronMatches('  05   09 *  *\t*  ', at('2024-03-05T09:05:00Z')), true);
});

test('invalid expressions throw SyntaxError', () => {
  const d = at('2024-03-05T10:20:00Z');
  for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 0 *', '* * * 13 *', '* * * * 7', '*/0 * * * *', '5-2 * * * *', '5/2 * * * *', '*/-1 * * * *', 'a * * * *', '1,,2 * * * *', '1- * * * *', '-1 * * * *', '* * * JAN *', '* * * * MON', '1.5 * * * *', '*/ * * * *', '**  * * * *']) {
    assert.throws(() => cronMatches(bad, d), SyntaxError, JSON.stringify(bad));
  }
});

test('invalid argument types throw TypeError', () => {
  for (const bad of [null, undefined, 5, ['* * * * *']]) assert.throws(() => cronMatches(bad, new Date()), TypeError);
  for (const bad of [null, undefined, '2024-03-05', new Date(NaN), 0, {}]) assert.throws(() => cronMatches('* * * * *', bad), TypeError);
});
