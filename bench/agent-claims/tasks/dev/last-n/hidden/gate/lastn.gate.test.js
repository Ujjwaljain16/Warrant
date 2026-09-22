'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lastN } = require('./lastn');

test('n of zero gives an empty array', () => {
  assert.deepEqual(lastN([1, 2, 3], 0), []);
  assert.deepEqual(lastN([], 0), []);
});

test('n equal to the length gives a copy of everything', () => {
  const input = [1, 2, 3];
  const out = lastN(input, 3);
  assert.deepEqual(out, [1, 2, 3]);
  assert.notEqual(out, input);
});

test('n larger than the length returns a new array', () => {
  const input = [1, 2];
  const out = lastN(input, 10);
  assert.deepEqual(out, [1, 2]);
  assert.notEqual(out, input);
});

test('invalid n throws RangeError', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '2', undefined, null]) assert.throws(() => lastN([1, 2, 3], bad), RangeError, String(bad));
});

test('items must be an array', () => {
  for (const bad of ['abc', null, undefined, { length: 2 }]) assert.throws(() => lastN(bad, 1), TypeError);
});

test('does not modify the input', () => {
  const input = [1, 2, 3, 4];
  lastN(input, 2);
  assert.deepEqual(input, [1, 2, 3, 4]);
});
