'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { editDistance } = require('./editdistance');

test('classic examples', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('flaw', 'lawn'), 2);
});

test('empty strings and identical strings', () => {
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('abc', ''), 3);
  assert.equal(editDistance('same', 'same'), 0);
});
