'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./expr');

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `expected ${b}, got ${a}`);

test('audit: agrees with JavaScript on random expressions over + - * / and parentheses', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const gen = (depth) => {
    if (depth === 0 || rnd() < 0.25) return String(1 + Math.floor(rnd() * 9));
    const op = '+-*'[Math.floor(rnd() * 3)];
    const left = gen(depth - 1);
    const right = gen(depth - 1);
    return rnd() < 0.5 ? `(${left} ${op} ${right})` : `${left} ${op} ${right}`;
  };
  for (let i = 0; i < 100; i++) {
    const expr = gen(4);
    close(evaluate(expr), Function(`"use strict"; return (${expr});`)());
  }
});

test('audit: mixed operators', () => {
  close(evaluate('2 + 3 * 4 ^ 2 / 8 - 1'), 7);
  close(evaluate('2 ^ 0.5 * 2 ^ 0.5'), 2);
  close(evaluate('10 - 2 ^ 3 ^ 0'), 8);
  close(evaluate('-(-2) ^ 2'), -4);
  close(evaluate('(2 + 3) ^ 2 % 7'), 4);
});

test('audit: a long flat expression', () => {
  const parts = Array.from({ length: 500 }, (_, i) => String(i + 1));
  assert.equal(evaluate(parts.join(' + ')), 125250);
});

test('audit: deeply nested parentheses', () => {
  assert.equal(evaluate('('.repeat(200) + '5' + ')'.repeat(200)), 5);
});

test('audit: a zero divisor produced by an expression, but zero numerators are fine', () => {
  assert.equal(evaluate('0 / 5'), 0);
  assert.equal(evaluate('0 % 5'), 0);
  assert.throws(() => evaluate('4 / (1 - 1)'), RangeError);
});
