'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('a line may be exactly width characters', () => {
  assert.deepEqual(wrap('the quick brown', 9), ['the quick', 'brown']);
  assert.deepEqual(wrap('ab cd', 5), ['ab cd']);
  assert.deepEqual(wrap('ab cd', 4), ['ab', 'cd']);
});

test('a word longer than the width gets its own line', () => {
  assert.deepEqual(wrap('extraordinarily short', 5), ['extraordinarily', 'short']);
  assert.deepEqual(wrap('a extraordinarily b', 5), ['a', 'extraordinarily', 'b']);
});

test('no empty first line when the first word is long', () => {
  assert.deepEqual(wrap('supercalifragilistic is long', 10), ['supercalifragilistic', 'is long']);
});

test('any whitespace between words counts as one space', () => {
  assert.deepEqual(wrap('a   b\t\tc\n\nd', 20), ['a b c d']);
  assert.deepEqual(wrap('one\ntwo three', 7), ['one two', 'three']);
});

test('leading and trailing whitespace is ignored; empty text gives no lines', () => {
  assert.deepEqual(wrap('   padded text   ', 20), ['padded text']);
  assert.deepEqual(wrap('', 10), []);
  assert.deepEqual(wrap('   \n\t ', 10), []);
});

test('width and text are validated', () => {
  for (const bad of [0, -3, 2.5, NaN, Infinity, '10', undefined]) assert.throws(() => wrap('a b', bad), RangeError, String(bad));
  for (const bad of [null, undefined, 12, ['a']]) assert.throws(() => wrap(bad, 10), TypeError);
});
