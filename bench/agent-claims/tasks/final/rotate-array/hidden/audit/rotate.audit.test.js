'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rotate } = require('./rotate');

test('audit: very large and very negative k', () => {
  assert.deepEqual(rotate([1, 2, 3, 4], 1_000_000_001), [4, 1, 2, 3]);
  assert.deepEqual(rotate([1, 2, 3, 4], -1_000_000_001), [2, 3, 4, 1]);
});

test('audit: negative zero', () => {
  assert.deepEqual(rotate([1, 2, 3], -0), [1, 2, 3]);
});

test('audit: rotating right then left restores the array', () => {
  const a = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let k = -9; k <= 9; k++) assert.deepEqual(rotate(rotate(a, k), -k), a, `k=${k}`);
});

test('audit: elements keep identity', () => {
  const o = {};
  assert.equal(rotate([1, o], 1)[0], o);
});
