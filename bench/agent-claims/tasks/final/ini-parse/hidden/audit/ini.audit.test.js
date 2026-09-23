'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIni } = require('./ini');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('audit: a single quote character is not a quoted value', () => {
  assert.deepEqual(plain(parseIni('a = "')), { a: '"' });
});

test('audit: keys with spaces and symbols', () => {
  assert.deepEqual(plain(parseIni('my key = v\nk.sub-name = w')), { 'my key': 'v', 'k.sub-name': 'w' });
});

test('audit: a section named like a key and the same name as a top-level key', () => {
  assert.deepEqual(plain(parseIni('[a]\nb = 1\n[c]\nb = 2')), { a: { b: '1' }, c: { b: '2' } });
});

test('audit: the first error wins', () => {
  try { parseIni('ok = 1\nbad\nworse'); assert.fail('should throw'); } catch (e) { assert.equal(e.line, 2); }
});

test('audit: a header with trailing spaces and a comment-like value', () => {
  assert.deepEqual(plain(parseIni('[ s ]   \nk = ;v')), { s: { k: ';v' } });
});

test('audit: a key line with only an equals sign and spaces is an empty key', () => {
  try { parseIni('a=1\n   =   '); assert.fail('should throw'); } catch (e) { assert.equal(e.line, 2); assert.ok(e instanceof SyntaxError); }
});
