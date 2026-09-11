'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('fills a line up to the width', () => {
  assert.equal(wrap('aaa bbb ccc', 7), 'aaa bbb\nccc');
  assert.equal(wrap('aaa bbb ccc', 11), 'aaa bbb ccc');
});

test('a word longer than the width keeps its own line', () => {
  assert.equal(wrap('abcdefghij', 5), 'abcdefghij');
  assert.equal(wrap('hi abcdefghij yo', 5), 'hi\nabcdefghij\nyo');
});

test('repeated whitespace collapses', () => {
  assert.equal(wrap('a   b\n\tc', 10), 'a b c');
});

test('text without words gives an empty string', () => {
  assert.equal(wrap('', 10), '');
  assert.equal(wrap('   ', 10), '');
});

test('an invalid width is a RangeError and a non-string a TypeError', () => {
  for (const width of [0, -3, 2.5, '8', undefined]) assert.throws(() => wrap('a b', width), RangeError);
  assert.throws(() => wrap(null, 5), TypeError);
});
