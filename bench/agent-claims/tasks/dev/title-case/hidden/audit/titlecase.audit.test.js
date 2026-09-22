'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titleCase } = require('./titlecase');

test('audit: only whole small words are lower-cased', () => {
  assert.equal(titleCase('x another x'), 'X Another X');
  assert.equal(titleCase('x ant x'), 'X Ant X');
  assert.equal(titleCase('x in-law x'), 'X In-Law X');
});

test('audit: two small words in a row in the middle, and a small word last', () => {
  assert.equal(titleCase('go on to the end of'), 'Go on to the End Of');
});

test('audit: digits and punctuation inside words', () => {
  assert.equal(titleCase('route 66 is a road'), 'Route 66 Is a Road');
  assert.equal(titleCase('hello, world'), 'Hello, World');
});
