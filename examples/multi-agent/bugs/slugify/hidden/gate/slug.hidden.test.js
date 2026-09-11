'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slug');

test('joins words with a dash', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('a run of separators becomes one dash', () => {
  assert.equal(slugify('a  --  b'), 'a-b');
});

test('never starts or ends with a dash', () => {
  assert.equal(slugify('  !!Hi!!  '), 'hi');
});

test('accents are replaced by their plain letters', () => {
  assert.equal(slugify('Café Münster'), 'cafe-munster');
});

test('nothing usable gives an empty string', () => {
  assert.equal(slugify('?!?'), '');
  assert.equal(slugify(''), '');
});

test('non-strings are rejected', () => {
  assert.throws(() => slugify(42), TypeError);
  assert.throws(() => slugify(null), TypeError);
});
