'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titleCase } = require('./titlecase');

test('the first and last words are capitalized even when small', () => {
  assert.equal(titleCase('of mice and men'), 'Of Mice and Men');
  assert.equal(titleCase('a tale to'), 'A Tale To');
  assert.equal(titleCase('the'), 'The');
});

test('whitespace is preserved exactly', () => {
  assert.equal(titleCase('a  big   cat'), 'A  Big   Cat');
  assert.equal(titleCase('  hello world  '), '  Hello World  ');
  assert.equal(titleCase('one\ttwo\nthree'), 'One\tTwo\nThree');
});

test('hyphenated words are capitalized part by part', () => {
  assert.equal(titleCase('a well-known fact'), 'A Well-Known Fact');
  assert.equal(titleCase('my mother-in-law'), 'My Mother-In-Law');
});

test('apostrophes do not start a new part', () => {
  assert.equal(titleCase("don't stop"), "Don't Stop");
  assert.equal(titleCase("rock 'n' roll"), "Rock 'n' Roll");
});

test('small words are recognised ignoring case', () => {
  assert.equal(titleCase('war OF the worlds'), 'War of the Worlds');
  assert.equal(titleCase('WAR AND PEACE'), 'War and Peace');
});

test('empty string and non-strings', () => {
  assert.equal(titleCase(''), '');
  assert.equal(titleCase('   '), '   ');
  for (const bad of [null, undefined, 5, ['a']]) assert.throws(() => titleCase(bad), TypeError);
});
