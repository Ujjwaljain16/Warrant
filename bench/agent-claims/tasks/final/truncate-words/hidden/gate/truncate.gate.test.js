'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { truncate } = require('./truncate');

test('text of exactly max characters is unchanged', () => {
  assert.equal(truncate('hello world', 11), 'hello world');
});

test('the ellipsis counts toward the limit', () => {
  const out = truncate('hello wonderful world', 15);
  assert.equal(out, 'hello…');
  assert.ok(out.length <= 15);
  assert.equal(truncate('aaaa bbbb cccc', 10), 'aaaa bbbb…');
  assert.equal(truncate('aaaa bbbb cccc', 9), 'aaaa…');
});

test('a custom ellipsis', () => {
  assert.equal(truncate('aaaa bbbb cccc', 12, '...'), 'aaaa bbbb...');
  assert.equal(truncate('aaaa bbbb cccc', 11, '...'), 'aaaa...');
  assert.equal(truncate('aaaa bbbb cccc', 11, ''), 'aaaa bbbb');
});

test('tabs and newlines are boundaries too', () => {
  assert.equal(truncate('alpha\tbeta\ngamma delta', 13), 'alpha\tbeta…');
  assert.equal(truncate('one\ntwo three four', 7), 'one…');
});

test('a first word that is too long is cut hard', () => {
  assert.equal(truncate('supercalifragilistic', 8), 'superca…');
  assert.equal(truncate('supercalifragilistic and more', 10), 'supercali…');
});

test('multiple spaces do not leave trailing whitespace before the ellipsis', () => {
  assert.equal(truncate('aaa    bbb ccc', 9), 'aaa…');
});

test('invalid arguments', () => {
  for (const bad of [0, 0.5, NaN, '5', undefined, Infinity]) assert.throws(() => truncate('hello world', bad), RangeError, String(bad));
  assert.throws(() => truncate('hello world', 2, '...'), RangeError);
  for (const bad of [null, undefined, 5]) assert.throws(() => truncate(bad, 10), TypeError);
  assert.throws(() => truncate('hello world', 5, 7), TypeError);
});
