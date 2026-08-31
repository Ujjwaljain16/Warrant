'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('audit: mixed accents, digits and punctuation', () => {
  assert.equal(slugify('Ünï-cödé 2 Ñandú'), 'uni-code-2-nandu');
  assert.equal(slugify('...a...b...'), 'a-b');
});
