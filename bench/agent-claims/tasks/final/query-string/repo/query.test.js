'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('./query');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('simple pairs and a leading question mark', () => {
  assert.deepEqual(plain(parseQuery('a=1&b=2')), { a: '1', b: '2' });
  assert.deepEqual(plain(parseQuery('?x=y')), { x: 'y' });
});

test('repeated keys become arrays', () => {
  assert.deepEqual(plain(parseQuery('a=1&a=2')), { a: ['1', '2'] });
});
