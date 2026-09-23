'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBrackets } = require('./brackets');

test('brackets inside strings are ignored', () => {
  assert.deepEqual(checkBrackets('f(")")'), { ok: true });
  assert.deepEqual(checkBrackets("f('(' + \"[\")"), { ok: true });
  assert.deepEqual(checkBrackets('x = "{"'), { ok: true });
});

test('escapes inside strings', () => {
  assert.deepEqual(checkBrackets('f("a\\"b)")'), { ok: true });
  assert.deepEqual(checkBrackets("f('it\\'s ]')"), { ok: true });
  assert.deepEqual(checkBrackets('f("\\\\")'), { ok: true });
});

test('brackets inside comments are ignored', () => {
  assert.deepEqual(checkBrackets('a(1) // )))\nb(2)'), { ok: true });
  assert.deepEqual(checkBrackets('a /* ( [ { */ b'), { ok: true });
  assert.deepEqual(checkBrackets('a /* multi\nline ) */ (b)'), { ok: true });
});

test('comment markers inside strings are text', () => {
  assert.deepEqual(checkBrackets('f("// not a comment", ")")'), { ok: true });
  assert.deepEqual(checkBrackets('f("/*") )'), { ok: false, reason: 'unexpected-closer', index: 8 });
});

test('quotes inside comments do not start strings', () => {
  assert.deepEqual(checkBrackets("a // don't\nb(c)"), { ok: true });
  assert.deepEqual(checkBrackets('a /* " */ (b)'), { ok: true });
});

test('unterminated strings and comments', () => {
  assert.deepEqual(checkBrackets('f("abc'), { ok: false, reason: 'unterminated-string', index: 2 });
  assert.deepEqual(checkBrackets('f("abc\n")'), { ok: false, reason: 'unterminated-string', index: 2 });
  assert.deepEqual(checkBrackets("x = 'a\\"), { ok: false, reason: 'unterminated-string', index: 4 });
  assert.deepEqual(checkBrackets('a /* open'), { ok: false, reason: 'unterminated-comment', index: 2 });
});

test('unexpected closers, mismatches and unclosed brackets', () => {
  assert.deepEqual(checkBrackets(')'), { ok: false, reason: 'unexpected-closer', index: 0 });
  assert.deepEqual(checkBrackets('a(b))'), { ok: false, reason: 'unexpected-closer', index: 4 });
  assert.deepEqual(checkBrackets('{[}]'), { ok: false, reason: 'mismatch', index: 2 });
  assert.deepEqual(checkBrackets('([{'), { ok: false, reason: 'unclosed', index: 2 });
  assert.deepEqual(checkBrackets('a(b[c]'), { ok: false, reason: 'unclosed', index: 1 });
});

test('the first problem wins', () => {
  assert.deepEqual(checkBrackets('(]"abc'), { ok: false, reason: 'mismatch', index: 1 });
  assert.deepEqual(checkBrackets('"abc\n)'), { ok: false, reason: 'unterminated-string', index: 0 });
  assert.deepEqual(checkBrackets('( /* x'), { ok: false, reason: 'unterminated-comment', index: 2 });
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 5, ['(']]) assert.throws(() => checkBrackets(bad), TypeError);
});
