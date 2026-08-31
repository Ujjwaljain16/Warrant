'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('basic words', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('runs of other characters collapse into one dash', () => {
  assert.equal(slugify('a   b'), 'a-b');
  assert.equal(slugify('a -- b'), 'a-b');
  assert.equal(slugify('rock & roll!'), 'rock-roll');
});

test('never starts or ends with a dash', () => {
  assert.equal(slugify('  padded  '), 'padded');
  assert.equal(slugify('--wow--'), 'wow');
});

test('accents are reduced to plain letters', () => {
  assert.equal(slugify('Café Crème'), 'cafe-creme');
});

test('digits are kept', () => {
  assert.equal(slugify('Top 10 of 2024'), 'top-10-of-2024');
});

test('nothing usable gives an empty string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!!'), '');
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 42, {}, ['a']]) assert.throws(() => slugify(bad), TypeError);
});
