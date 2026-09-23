'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBrackets } = require('./brackets');

test('audit: a line comment at the very end without a newline', () => {
  assert.deepEqual(checkBrackets('a(b) // ('), { ok: true });
});

test('audit: a slash that is not a comment', () => {
  assert.deepEqual(checkBrackets('a / (b / c)'), { ok: true });
  assert.deepEqual(checkBrackets('a /'), { ok: true });
});

test('audit: a block comment immediately closed, and nested-looking comments', () => {
  assert.deepEqual(checkBrackets('/**/(x)'), { ok: true });
  assert.deepEqual(checkBrackets('/* /* ( */ ) '), { ok: false, reason: 'unexpected-closer', index: 11 });
});

test('audit: a single-quoted string containing double quotes and brackets', () => {
  assert.deepEqual(checkBrackets("f('\"(')"), { ok: true });
});

test('audit: deep nesting', () => {
  assert.deepEqual(checkBrackets('('.repeat(500) + ')'.repeat(500)), { ok: true });
  assert.deepEqual(checkBrackets('('.repeat(500) + ')'.repeat(499)), { ok: false, reason: 'unclosed', index: 0 });
});

test('audit: carriage return ends a string too', () => {
  assert.deepEqual(checkBrackets('"abc\r\n"'), { ok: false, reason: 'unterminated-string', index: 0 });
});
