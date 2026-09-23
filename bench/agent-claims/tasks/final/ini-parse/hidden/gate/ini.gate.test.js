'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIni } = require('./ini');

const plain = (o) => JSON.parse(JSON.stringify(o));
const lineOf = (text) => { try { parseIni(text); } catch (e) { return e instanceof SyntaxError ? e.line : `wrong error ${e && e.name}`; } return 'no error'; };

test('only the first = splits; values are trimmed; empty values', () => {
  assert.deepEqual(plain(parseIni('url = http://x/?a=b=c\nempty =\n  spaced   =   wide value  ')), { url: 'http://x/?a=b=c', empty: '', spaced: 'wide value' });
});

test('quoted values keep their spaces; quotes are removed', () => {
  assert.deepEqual(plain(parseIni('a = "  padded  "\nb = "x=y"\nc = ""\nd = "unclosed\ne = say "hi"')), { a: '  padded  ', b: 'x=y', c: '', d: '"unclosed', e: 'say "hi"' });
});

test('no inline comments', () => {
  assert.deepEqual(plain(parseIni('a = 1 ; not a comment\nb = 2 # neither')), { a: '1 ; not a comment', b: '2 # neither' });
});

test('comments are recognised after trimming', () => {
  assert.deepEqual(plain(parseIni('   ; indented comment\n\t# another\nk = v')), { k: 'v' });
});

test('repeated sections merge and repeated keys replace', () => {
  const text = '[a]\nx = 1\n[b]\ny = 2\n[a]\nz = 3\nx = 9\n';
  assert.deepEqual(plain(parseIni(text)), { a: { x: '9', z: '3' }, b: { y: '2' } });
});

test('section names are trimmed and top-level keys come first', () => {
  assert.deepEqual(plain(parseIni('top = 1\n[ db ]\nhost = h\n')), { top: '1', db: { host: 'h' } });
});

test('CRLF line endings', () => {
  assert.deepEqual(plain(parseIni('[s]\r\na = 1\r\n\r\nb = 2\r\n')), { s: { a: '1', b: '2' } });
});

test('values are strings and the objects have no prototype', () => {
  const r = parseIni('n = 42\nt = true\n[s]\n__proto__ = x\n');
  assert.equal(r.n, '42');
  assert.equal(r.t, 'true');
  assert.equal(Object.getPrototypeOf(r), null);
  assert.equal(Object.getPrototypeOf(r.s), null);
  assert.equal(Object.keys(r.s)[0], '__proto__');
});

test('syntax errors carry the 1-based line number', () => {
  assert.equal(lineOf('a = 1\njust words\nb = 2'), 2);
  assert.equal(lineOf('\n\n= value'), 3);
  assert.equal(lineOf('[]'), 1);
  assert.equal(lineOf('x = 1\n[ ]'), 2);
  assert.equal(lineOf('ok = 1\n[unclosed\n'), 2);
  assert.equal(lineOf('; c\n# c\n\nbad line here'), 4);
});

test('the empty text and non-strings', () => {
  assert.deepEqual(plain(parseIni('')), {});
  assert.deepEqual(plain(parseIni('\n\n; only a comment\n')), {});
  for (const bad of [null, undefined, 5, ['a=1']]) assert.throws(() => parseIni(bad), TypeError);
});
