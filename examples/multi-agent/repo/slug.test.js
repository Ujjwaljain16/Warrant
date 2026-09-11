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
