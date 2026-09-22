'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvLine } = require('./csvline');

test('plain fields', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
});

test('a quoted field may contain a comma', () => {
  assert.deepEqual(parseCsvLine('x,"y,z",w'), ['x', 'y,z', 'w']);
});
