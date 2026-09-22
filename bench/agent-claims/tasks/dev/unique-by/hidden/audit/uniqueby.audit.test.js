'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueBy } = require('./uniqueby');

test('audit: undefined and null are keys like any other', () => {
  assert.deepEqual(uniqueBy([undefined, null, undefined, null]), [undefined, null]);
});

test('audit: a key function that returns NaN or objects', () => {
  assert.equal(uniqueBy([1, 2, 3], () => NaN).length, 1);
  assert.equal(uniqueBy([1, 2, 3], () => ({})).length, 3);
});

test('audit: strings and numbers with the same text are different keys', () => {
  assert.deepEqual(uniqueBy([1, '1', 1, '1']), [1, '1']);
});
