'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueBy } = require('./uniqueby');

test('removes duplicate primitives, keeping the first', () => {
  assert.deepEqual(uniqueBy([1, 2, 1, 3, 2]), [1, 2, 3]);
  assert.deepEqual(uniqueBy(['b', 'a', 'b']), ['b', 'a']);
});

test('uses a key function', () => {
  const rows = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }];
  assert.deepEqual(uniqueBy(rows, (r) => r.id), [rows[0], rows[1]]);
});
