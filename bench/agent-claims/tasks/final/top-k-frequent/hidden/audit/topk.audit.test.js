'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topK } = require('./topk');

test('audit: a long tie group is fully sorted', () => {
  const words = ['pear', 'apple', 'fig', 'kiwi', 'date', 'plum', 'lime'];
  assert.deepEqual(topK(words, 7), [...words].sort());
});

test('audit: three levels of counts with ties inside each level', () => {
  const items = ['c', 'c', 'c', 'b', 'b', 'a', 'a', 'e', 'd'];
  assert.deepEqual(topK(items, 5), ['c', 'a', 'b', 'd', 'e']);
});

test('audit: empty string and unusual strings are ordinary', () => {
  assert.deepEqual(topK(['', 'a', ''], 2), ['', 'a']);
  assert.deepEqual(topK(['10', '9', '10', '9'], 2), ['10', '9']);
});
