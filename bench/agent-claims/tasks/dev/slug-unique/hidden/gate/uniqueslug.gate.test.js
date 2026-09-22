'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueSlug } = require('./uniqueslug');

test('the first free suffix is used, not the count of taken slugs', () => {
  assert.equal(uniqueSlug('a', ['a', 'a-2']), 'a-3');
  assert.equal(uniqueSlug('a', ['a', 'a-3']), 'a-2');
  assert.equal(uniqueSlug('a', ['a', 'a-2', 'a-3', 'a-4']), 'a-5');
});

test('a free base is returned even when suffixed names are taken', () => {
  assert.equal(uniqueSlug('a', ['a-2', 'a-3']), 'a');
  assert.equal(uniqueSlug('a', ['b', 'c', 'd']), 'a');
});

test('unrelated taken slugs do not matter', () => {
  assert.equal(uniqueSlug('post', ['x', 'y', 'post', 'z']), 'post-2');
});

test('sets work and nothing is modified', () => {
  const taken = new Set(['a', 'a-2']);
  assert.equal(uniqueSlug('a', taken), 'a-3');
  assert.deepEqual([...taken], ['a', 'a-2']);
  const list = ['a'];
  uniqueSlug('a', list);
  assert.deepEqual(list, ['a']);
});

test('an empty base becomes untitled', () => {
  assert.equal(uniqueSlug('', []), 'untitled');
  assert.equal(uniqueSlug('', ['untitled']), 'untitled-2');
  assert.equal(uniqueSlug('', ['untitled', 'untitled-2']), 'untitled-3');
});

test('comparison is case-sensitive', () => {
  assert.equal(uniqueSlug('Hello', ['hello']), 'Hello');
});

test('argument types', () => {
  assert.throws(() => uniqueSlug(5, []), TypeError);
  assert.throws(() => uniqueSlug(undefined, []), TypeError);
  assert.throws(() => uniqueSlug('a', 'a'), TypeError);
  assert.throws(() => uniqueSlug('a', null), TypeError);
  assert.throws(() => uniqueSlug('a'), TypeError);
});
