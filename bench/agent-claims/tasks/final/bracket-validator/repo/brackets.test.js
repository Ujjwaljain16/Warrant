'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBrackets } = require('./brackets');

test('balanced text', () => {
  assert.deepEqual(checkBrackets('f(a[0], {b: 1})'), { ok: true });
  assert.deepEqual(checkBrackets(''), { ok: true });
});

test('a mismatch', () => {
  assert.deepEqual(checkBrackets('(]'), { ok: false, reason: 'mismatch', index: 1 });
});

test('an unclosed bracket', () => {
  assert.deepEqual(checkBrackets('(('), { ok: false, reason: 'unclosed', index: 1 });
});
