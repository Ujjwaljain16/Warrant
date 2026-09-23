'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('./query');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('percent-decoding as UTF-8, and plus as space', () => {
  assert.deepEqual(plain(parseQuery('a=%E2%82%AC&b=caf%C3%A9')), { a: '€', b: 'café' });
  assert.deepEqual(plain(parseQuery('q=hello+world&r=a%20b')), { q: 'hello world', r: 'a b' });
  assert.deepEqual(plain(parseQuery('x=%2B&y=%2b')), { x: '+', y: '+' });
  assert.deepEqual(plain(parseQuery('k%20ey=v')), { 'k ey': 'v' });
  assert.deepEqual(plain(parseQuery('na+me=1')), { 'na me': '1' });
});

test('malformed escapes stay literal and do not disturb valid ones', () => {
  assert.deepEqual(plain(parseQuery('a=%zz')), { a: '%zz' });
  assert.deepEqual(plain(parseQuery('a=100%')), { a: '100%' });
  assert.deepEqual(plain(parseQuery('a=%4')), { a: '%4' });
  assert.deepEqual(plain(parseQuery('a=x%zz%41')), { a: 'x%zzA' });
  assert.deepEqual(plain(parseQuery('a=%41%')), { a: 'A%' });
  assert.deepEqual(plain(parseQuery('a=5%25')), { a: '5%' });
});

test('empty segments, missing equals signs and empty keys', () => {
  assert.deepEqual(plain(parseQuery('a=1&&b=2&')), { a: '1', b: '2' });
  assert.deepEqual(plain(parseQuery('flag&x=')), { flag: '', x: '' });
  assert.deepEqual(plain(parseQuery('=x&a=1')), { a: '1' });
  assert.deepEqual(plain(parseQuery('')), {});
  assert.deepEqual(plain(parseQuery('?')), {});
});

test('only the first equals sign splits', () => {
  assert.deepEqual(plain(parseQuery('a=b=c&d==')), { a: 'b=c', d: '=' });
});

test('repeated keys', () => {
  assert.deepEqual(plain(parseQuery('a=1&a=2&a=3')), { a: ['1', '2', '3'] });
  assert.deepEqual(plain(parseQuery('a=1&b=x&a=2')), { a: ['1', '2'], b: 'x' });
  assert.deepEqual(plain(parseQuery('a&a=')), { a: ['', ''] });
});

test('keys that would collide with Object.prototype', () => {
  const r = parseQuery('__proto__=1&constructor=2&toString=3&hasOwnProperty=4');
  assert.equal(Object.getPrototypeOf(r), null);
  assert.deepEqual(Object.keys(r), ['__proto__', 'constructor', 'toString', 'hasOwnProperty']);
  assert.equal(r.constructor, '2');
  assert.equal(r.toString, '3');
  const twice = parseQuery('constructor=1&constructor=2');
  assert.deepEqual(twice.constructor, ['1', '2']);
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 5, ['a=1']]) assert.throws(() => parseQuery(bad), TypeError);
});
