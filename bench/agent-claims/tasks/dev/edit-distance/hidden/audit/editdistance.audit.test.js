'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { editDistance } = require('./editdistance');

test('audit: swaps at the very start and very end', () => {
  assert.equal(editDistance('abxx', 'baxx'), 1);
  assert.equal(editDistance('xxab', 'xxba'), 1);
});

test('audit: repeated characters are not swapped needlessly', () => {
  assert.equal(editDistance('aab', 'aba'), 1);
  assert.equal(editDistance('aaa', 'aaa'), 0);
});

test('audit: longer strings against known values', () => {
  assert.equal(editDistance('sunday', 'saturday'), 3);
  assert.equal(editDistance('intention', 'execution'), 5);
  assert.equal(editDistance('abcdefgh', 'abcdefhg'), 1);
});

test('audit: bounded by the longer length, zero only for equal strings', () => {
  const words = ['', 'x', 'xy', 'hello', 'world', 'help', 'ehllo'];
  for (const x of words) {
    for (const y of words) {
      const d = editDistance(x, y);
      assert.ok(d <= Math.max(x.length, y.length));
      assert.equal(d === 0, x === y);
    }
  }
});
