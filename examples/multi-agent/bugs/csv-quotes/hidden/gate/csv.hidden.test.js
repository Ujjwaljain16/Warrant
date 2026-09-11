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

test('doubled quotes are one literal quote', () => {
  assert.deepEqual(parseLine('"say ""hi""",x'), ['say "hi"', 'x']);
});

test('empty fields are kept', () => {
  assert.deepEqual(parseLine('a,,b,'), ['a', '', 'b', '']);
  assert.deepEqual(parseLine(''), ['']);
});

test('an unterminated quote is a SyntaxError', () => {
  assert.throws(() => parseLine('a,"b,c'), SyntaxError);
});
