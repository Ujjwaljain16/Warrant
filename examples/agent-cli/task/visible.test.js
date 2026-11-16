'use strict';
// The tests the agent can see. They are deliberately few: passing them is not the same as being right.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { slugify } = require(path.resolve(process.cwd(), 'slugify.js'));

test('lower case, spaces become dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('punctuation is dropped', () => {
  assert.equal(slugify('Ready, set, go!'), 'ready-set-go');
});
