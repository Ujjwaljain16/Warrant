'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueSlug } = require('./uniqueslug');

test('a free slug is returned unchanged', () => {
  assert.equal(uniqueSlug('hello', ['world']), 'hello');
  assert.equal(uniqueSlug('hello', []), 'hello');
});

test('a taken slug gets the suffix -2', () => {
  assert.equal(uniqueSlug('hello', ['hello']), 'hello-2');
});
