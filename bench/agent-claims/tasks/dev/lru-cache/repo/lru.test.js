'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LruCache } = require('./lru');

test('stores and returns values', () => {
  const c = new LruCache(2);
  c.set('a', 1).set('b', 2);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('missing'), undefined);
  assert.equal(c.size, 2);
});

test('evicts the oldest entry when full', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.has('a'), false);
  assert.deepEqual(c.keys(), ['b', 'c']);
});
