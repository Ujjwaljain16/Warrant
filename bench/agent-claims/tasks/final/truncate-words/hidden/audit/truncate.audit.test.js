'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { truncate } = require('./truncate');

test('audit: max equal to the ellipsis length gives just the ellipsis', () => {
  assert.equal(truncate('hello world', 1), '…');
  assert.equal(truncate('hello world', 3, '...'), '...');
});

test('audit: result length never exceeds max', () => {
  const text = 'The quick brown fox jumps over the lazy dog and keeps running far away';
  for (let max = 1; max <= text.length + 2; max++) {
    const out = truncate(text, max);
    assert.ok(out.length <= max, `max ${max}: "${out}"`);
    if (text.length > max) assert.ok(out.endsWith('…'));
  }
});

test('audit: a boundary exactly at the limit is used', () => {
  assert.equal(truncate('abcd efgh', 6), 'abcd…');
  assert.equal(truncate('abcd efgh ijkl', 10), 'abcd efgh…');
});

test('audit: the cut falls on the last allowed boundary, not the first', () => {
  assert.equal(truncate('a b c d e f g', 8), 'a b c d…');
});
