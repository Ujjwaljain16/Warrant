'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LruCache } = require('./lru');

test('get refreshes recency', () => {
  const c = new LruCache(2);
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
  assert.equal(c.has('b'), false);
});

test('overwriting refreshes recency and never evicts', () => {
  const c = new LruCache(2);
  c.set('a', 1).set('b', 2);
  c.set('a', 10);
  assert.equal(c.size, 2);
  assert.deepEqual(c.keys(), ['b', 'a']);
  assert.equal(c.get('a'), 10);
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
});

test('has does not change the order', () => {
  const c = new LruCache(2);
  c.set('a', 1).set('b', 2);
  assert.equal(c.has('a'), true);
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['b', 'c']);
});

test('delete', () => {
  const c = new LruCache(3);
  c.set('a', 1).set('b', 2);
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  assert.equal(c.size, 1);
  assert.deepEqual(c.keys(), ['b']);
});

test('set returns the cache and capacity is validated', () => {
  const c = new LruCache(1);
  assert.equal(c.set('a', 1), c);
  for (const bad of [0, -1, 1.5, NaN, '2', undefined, Infinity]) assert.throws(() => new LruCache(bad), RangeError, String(bad));
});

test('capacity 1 keeps only the latest entry', () => {
  const c = new LruCache(1);
  c.set('a', 1).set('b', 2);
  assert.deepEqual(c.keys(), ['b']);
  assert.equal(c.get('a'), undefined);
});
