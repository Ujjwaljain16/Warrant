'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvLine } = require('./csvline');

test('doubled quotes inside a quoted field', () => {
  assert.deepEqual(parseCsvLine('"say ""hi""",b'), ['say "hi"', 'b']);
  assert.deepEqual(parseCsvLine('""""'), ['"']);
});

test('empty fields', () => {
  assert.deepEqual(parseCsvLine(''), ['']);
  assert.deepEqual(parseCsvLine('a,'), ['a', '']);
  assert.deepEqual(parseCsvLine(','), ['', '']);
  assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']);
  assert.deepEqual(parseCsvLine('""'), ['']);
  assert.deepEqual(parseCsvLine('"",x'), ['', 'x']);
});

test('spaces are kept', () => {
  assert.deepEqual(parseCsvLine(' a , b '), [' a ', ' b ']);
  assert.deepEqual(parseCsvLine('" a ",b'), [' a ', 'b']);
});

test('a quote in the middle of an unquoted field is ordinary text', () => {
  assert.deepEqual(parseCsvLine('5",a"b'), ['5"', 'a"b']);
});

test('a quoted field may hold a line break', () => {
  assert.deepEqual(parseCsvLine('"a\nb",c'), ['a\nb', 'c']);
});

test('malformed quoting throws SyntaxError', () => {
  for (const bad of ['"abc', 'a,"b', '"a"b', '"a" ,b', '"a""']) assert.throws(() => parseCsvLine(bad), SyntaxError, bad);
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 5, ['a']]) assert.throws(() => parseCsvLine(bad), TypeError);
});
