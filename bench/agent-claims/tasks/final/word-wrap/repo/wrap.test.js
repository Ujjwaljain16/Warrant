'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('wraps a sentence', () => {
  assert.deepEqual(wrap('the quick brown fox', 10), ['the quick', 'brown fox']);
});

test('short text stays on one line', () => {
  assert.deepEqual(wrap('hello world', 40), ['hello world']);
});
