'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titleCase } = require('./titlecase');

test('capitalizes words and keeps small words lower-case', () => {
  assert.equal(titleCase('the lord of the rings'), 'The Lord of the Rings');
});

test('lower-cases the rest of each word', () => {
  assert.equal(titleCase('hELLO wORLD'), 'Hello World');
});
