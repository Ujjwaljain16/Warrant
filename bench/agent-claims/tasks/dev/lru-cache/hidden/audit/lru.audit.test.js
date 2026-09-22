'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LruCache } = require('./lru');

test('audit: keys of any type, compared like Map keys', () => {
  const o = {};
  const c = new LruCache(5);
  c.set(NaN, 'nan').set(o, 'obj').set(1, 'num').set('1', 'str');
  assert.equal(c.get(NaN), 'nan');
  assert.equal(c.get(o), 'obj');
  assert.equal(c.get({}), undefined);
  assert.equal(c.get(1), 'num');
  assert.equal(c.get('1'), 'str');
});

test('audit: a stored undefined value still counts as present and is refreshed by get', () => {
  const c = new LruCache(2);
  c.set('a', undefined).set('b', 1);
  assert.equal(c.has('a'), true);
  assert.equal(c.get('a'), undefined);
  c.set('c', 2);
  assert.deepEqual(c.keys(), ['a', 'c']);
});

test('audit: a long sequence matches a reference model', () => {
  const c = new LruCache(3);
  const model = [];
  const touch = (k) => { const i = model.indexOf(k); if (i >= 0) model.splice(i, 1); model.push(k); };
  const ops = 'a b c a d b e a c f'.split(' ');
  ops.forEach((k, i) => {
    if (i % 3 === 0) { if (c.get(k) !== undefined) touch(k); } else { c.set(k, i); touch(k); if (model.length > 3) model.shift(); }
    assert.deepEqual(c.keys(), model, `after op ${i} (${k})`);
  });
});
