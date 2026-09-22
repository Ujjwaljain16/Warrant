'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvLine } = require('./csvline');

test('audit: quoted field at the end of the line, after an empty field', () => {
  assert.deepEqual(parseCsvLine(',"x,y"'), ['', 'x,y']);
  assert.deepEqual(parseCsvLine('a,"b"'), ['a', 'b']);
});

test('audit: comma-heavy and quote-heavy fields', () => {
  assert.deepEqual(parseCsvLine('",",",",","'), [',', ',', ',']);
  assert.deepEqual(parseCsvLine('"a""",b'), ['a"', 'b']);
});

test('audit: a lone quote starts a quoted field that never ends', () => {
  assert.throws(() => parseCsvLine('"'), SyntaxError);
  assert.deepEqual(parseCsvLine('a"'), ['a"']);
});

test('audit: carriage returns and tabs inside fields are kept', () => {
  assert.deepEqual(parseCsvLine('a\tb,"c\r\nd"'), ['a\tb', 'c\r\nd']);
});
