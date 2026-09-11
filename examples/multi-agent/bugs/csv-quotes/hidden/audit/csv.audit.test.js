'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('./csv');

test('a quoted empty field is an empty string', () => {
  assert.deepEqual(parseLine('"",a'), ['', 'a']);
});

test('a field that is only a quote', () => {
  assert.deepEqual(parseLine('""""'), ['"']);
});
