'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('./csv');

test('splits plain fields', () => {
  assert.deepEqual(parseLine('a,b,c'), ['a', 'b', 'c']);
});

test('a quoted field may contain a comma', () => {
  assert.deepEqual(parseLine('a,"b,c",d'), ['a', 'b,c', 'd']);
});
