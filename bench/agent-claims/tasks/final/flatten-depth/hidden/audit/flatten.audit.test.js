'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { flatten } = require('./flatten');

test('audit: objects that look like arrays are not flattened', () => {
  const like = { length: 1, 0: 'x' };
  assert.deepEqual(flatten([like, [like]], Infinity), [like, like]);
});

test('audit: depth 3 on a five-level structure', () => {
  assert.deepEqual(flatten([1, [2, [3, [4, [5]]]]], 3), [1, 2, 3, 4, [5]]);
});

test('audit: strings are not flattened into characters', () => {
  assert.deepEqual(flatten(['ab', ['cd']], Infinity), ['ab', 'cd']);
});

test('audit: moderately deep nesting with Infinity', () => {
  let nested = [0];
  for (let i = 1; i <= 500; i++) nested = [i, nested];
  assert.equal(flatten(nested, Infinity).length, 501);
});
