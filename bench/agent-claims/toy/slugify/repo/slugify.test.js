'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('lower-cases and joins words with a dash', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});
