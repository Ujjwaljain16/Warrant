'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slug');

test('digits are kept', () => {
  assert.equal(slugify('Top 10 Tips'), 'top-10-tips');
});

test('is idempotent', () => {
  assert.equal(slugify(slugify('Ünïcödé & Co.')), slugify('Ünïcödé & Co.'));
  assert.equal(slugify('Ünïcödé & Co.'), 'unicode-co');
});
