'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { editDistance } = require('./editdistance');

test('an adjacent swap costs one', () => {
  assert.equal(editDistance('ab', 'ba'), 1);
  assert.equal(editDistance('abcd', 'acbd'), 1);
  assert.equal(editDistance('teh', 'the'), 1);
  assert.equal(editDistance('recieve', 'receive'), 1);
});

test('a substring is not edited twice (optimal string alignment)', () => {
  assert.equal(editDistance('ca', 'abc'), 3);
  assert.equal(editDistance('abc', 'ca'), 3);
});

test('swaps combine with other edits', () => {
  assert.equal(editDistance('abcdef', 'badcfe'), 3);
  assert.equal(editDistance('ab', 'bac'), 2);
});

test('the distance is symmetric on a sample of pairs', () => {
  const words = ['', 'a', 'ab', 'ba', 'abc', 'cab', 'kitten', 'sitting', 'teh', 'the', 'xyzzy'];
  for (const x of words) for (const y of words) assert.equal(editDistance(x, y), editDistance(y, x), `${x} ${y}`);
});

test('arguments must be strings', () => {
  for (const bad of [null, undefined, 5, ['a']]) {
    assert.throws(() => editDistance(bad, 'a'), TypeError);
    assert.throws(() => editDistance('a', bad), TypeError);
  }
});
