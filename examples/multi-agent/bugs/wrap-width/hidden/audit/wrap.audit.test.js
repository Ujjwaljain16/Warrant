'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('no line exceeds the width unless it is one long word', () => {
  const out = wrap('the quick brown fox jumps over the lazy dog', 10);
  for (const line of out.split('\n')) assert.ok(line.length <= 10, line);
  assert.equal(out.replace(/\n/g, ' '), 'the quick brown fox jumps over the lazy dog');
});
