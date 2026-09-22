'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('./paginate');

test('first page of an evenly divisible list', () => {
  const r = paginate([1, 2, 3, 4, 5, 6], 1, 3);
  assert.deepEqual(r.items, [1, 2, 3]);
  assert.equal(r.totalPages, 2);
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, true);
});

test('second page', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6], 2, 3).items, [4, 5, 6]);
});
