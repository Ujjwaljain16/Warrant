'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { truncate } = require('./truncate');

test('short text is unchanged', () => {
  assert.equal(truncate('hello', 10), 'hello');
});

test('cuts at a word boundary', () => {
  assert.equal(truncate('the quick brown fox', 12), 'the quick…');
});
