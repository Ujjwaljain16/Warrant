'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('./query');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('audit: invalid UTF-8 becomes U+FFFD, valid sequences around it survive', () => {
  assert.deepEqual(plain(parseQuery('a=%FF')), { a: '�' });
  assert.deepEqual(plain(parseQuery('a=x%FFy')), { a: 'x�y' });
  assert.deepEqual(plain(parseQuery('a=%E2%82')), { a: '�' });
});

test('audit: four-byte characters and a plus inside an escape sequence run', () => {
  assert.deepEqual(plain(parseQuery('a=%F0%9F%98%80')), { a: '\u{1F600}' });
  assert.deepEqual(plain(parseQuery('a=%41+%42')), { a: 'A B' });
});

test('audit: only one leading question mark is ignored', () => {
  assert.deepEqual(plain(parseQuery('??a=1')), { '?a': '1' });
});

test('audit: key order is the order of first appearance', () => {
  assert.deepEqual(Object.keys(parseQuery('b=1&a=1&b=2&c=1')), ['b', 'a', 'c']);
});

test('audit: a key that decodes to the same text as another is the same key', () => {
  assert.deepEqual(plain(parseQuery('a%20b=1&a+b=2')), { 'a b': ['1', '2'] });
});
