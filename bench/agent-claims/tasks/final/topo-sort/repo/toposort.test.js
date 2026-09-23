'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topoSort } = require('./toposort');

test('dependencies come first', () => {
  assert.deepEqual(topoSort({ app: ['lib', 'util'], lib: ['util'], util: [] }), ['util', 'lib', 'app']);
});

test('a cycle is reported', () => {
  assert.throws(() => topoSort({ a: ['b'], b: ['a'] }), (e) => e.code === 'CYCLE');
});
