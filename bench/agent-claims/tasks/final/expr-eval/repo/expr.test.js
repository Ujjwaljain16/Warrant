'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./expr');

test('precedence of * over +', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7);
});

test('parentheses', () => {
  assert.equal(evaluate('(1 + 2) * 3'), 9);
});

test('division', () => {
  assert.equal(evaluate('10 / 4'), 2.5);
});
