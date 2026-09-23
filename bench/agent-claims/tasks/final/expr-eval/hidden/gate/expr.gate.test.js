'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./expr');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);

test('power is right-associative and binds tighter than unary minus', () => {
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluate('-2 ^ 2'), -4);
  assert.equal(evaluate('(-2) ^ 2'), 4);
  assert.equal(evaluate('2 ^ -1'), 0.5);
  assert.equal(evaluate('2 * 3 ^ 2'), 18);
  assert.equal(evaluate('-3 ^ 2 + 1'), -8);
});

test('unary signs may repeat', () => {
  assert.equal(evaluate('--3'), 3);
  assert.equal(evaluate('- -3'), 3);
  assert.equal(evaluate('+-+3'), -3);
  assert.equal(evaluate('4 - -2'), 6);
  assert.equal(evaluate('2 * -3'), -6);
});

test('left associativity of - / %', () => {
  assert.equal(evaluate('10 - 4 - 3'), 3);
  assert.equal(evaluate('100 / 10 / 5'), 2);
  assert.equal(evaluate('17 % 10 % 4'), 3);
  assert.equal(evaluate('8 / 4 * 2'), 4);
});

test('remainder follows JavaScript', () => {
  assert.equal(evaluate('5 % 3'), 2);
  assert.equal(evaluate('-5 % 3'), -2);
  assert.equal(evaluate('5.5 % 2'), 1.5);
});

test('decimals, nesting and whitespace', () => {
  close(evaluate('.5 + 0.25'), 0.75);
  close(evaluate('3.25*4'), 13);
  assert.equal(evaluate('((((7))))'), 7);
  assert.equal(evaluate('  ( 1 +\t2 )\n* 3 '), 9);
  assert.equal(evaluate('2 * (3 + 4) * (5 - 1)'), 56);
});

test('division and remainder by zero are a RangeError', () => {
  assert.throws(() => evaluate('1 / 0'), RangeError);
  assert.throws(() => evaluate('5 % 0'), RangeError);
  assert.throws(() => evaluate('1 / (2 - 2)'), RangeError);
});

test('malformed input is a SyntaxError', () => {
  for (const bad of ['', '   ', '(', ')', '(1', '1)', '1 +', '+', '* 2', '1 2', '2 (3)', '(1)(2)', '1 + * 2', '3.', '1..2', 'abc', '1 + a', '2 ** 3', '1e3', '0x10', '1,5', '()', '1 ^', '^ 2', '1 +* 2']) {
    assert.throws(() => evaluate(bad), SyntaxError, JSON.stringify(bad));
  }
});

test('the evaluator does not run code', () => {
  for (const bad of ['process.exit(1)', 'constructor', 'this', '[]', '"a"', 'globalThis', '1; 2']) assert.throws(() => evaluate(bad), SyntaxError, bad);
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 5, ['1']]) assert.throws(() => evaluate(bad), TypeError);
});
