'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('./paginate');

const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('a partial last page', () => {
  const r = paginate(ten, 4, 3);
  assert.deepEqual(r.items, [10]);
  assert.equal(r.totalPages, 4);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrev, true);
});

test('totalPages rounds up', () => {
  assert.equal(paginate(ten, 1, 3).totalPages, 4);
  assert.equal(paginate(ten, 1, 10).totalPages, 1);
  assert.equal(paginate(ten, 1, 100).totalPages, 1);
});

test('an empty input has zero pages and page 1 is empty', () => {
  assert.deepEqual(paginate([], 1, 5), { items: [], page: 1, perPage: 5, totalItems: 0, totalPages: 0, hasPrev: false, hasNext: false });
});

test('a page past the end is empty and echoes the page', () => {
  const r = paginate(ten, 9, 3);
  assert.deepEqual(r.items, []);
  assert.equal(r.page, 9);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrev, true);
});

test('page and perPage must be positive integers', () => {
  for (const bad of [0, -1, 1.5, NaN, '1', undefined]) {
    assert.throws(() => paginate(ten, bad, 3), RangeError, `page ${bad}`);
    assert.throws(() => paginate(ten, 1, bad), RangeError, `perPage ${bad}`);
  }
});

test('the result holds a new array and the input is unchanged', () => {
  const input = [1, 2, 3];
  const r = paginate(input, 1, 5);
  r.items.push(99);
  assert.deepEqual(input, [1, 2, 3]);
});
