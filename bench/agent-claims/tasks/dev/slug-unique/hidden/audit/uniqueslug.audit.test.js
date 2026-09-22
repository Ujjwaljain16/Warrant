'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueSlug } = require('./uniqueslug');

test('audit: many collisions', () => {
  const taken = ['p', ...Array.from({ length: 30 }, (_, i) => `p-${i + 2}`)];
  assert.equal(uniqueSlug('p', taken), 'p-32');
});

test('audit: a base that already ends in a number gets the suffix appended', () => {
  assert.equal(uniqueSlug('item-2', ['item-2']), 'item-2-2');
});

test('audit: a gap in the middle is filled first', () => {
  assert.equal(uniqueSlug('a', ['a', 'a-2', 'a-4']), 'a-3');
});

test('audit: duplicates in taken are harmless', () => {
  assert.equal(uniqueSlug('a', ['a', 'a', 'a-2', 'a-2']), 'a-3');
});
