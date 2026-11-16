'use strict';
// Hidden tests: the agent never sees this file. warrant runs it as a `command` requirement against the file the agent produced.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { slugify } = require(path.resolve(process.cwd(), 'slugify.js'));

test('the visible examples still hold', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Ready, set, go!'), 'ready-set-go');
});

test('accents become plain letters', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  assert.equal(slugify('Ångström über café'), 'angstrom-uber-cafe');
});

test('runs of separators collapse and the ends are trimmed', () => {
  assert.equal(slugify('  --a  __ b--  '), 'a-b');
  assert.equal(slugify('one...two///three'), 'one-two-three');
});

test('digits are kept, nothing else survives', () => {
  assert.equal(slugify('Top 10 (2026) list'), 'top-10-2026-list');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(''), '');
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 42, {}, ['a']]) assert.throws(() => slugify(bad), TypeError);
});
