'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('./paginate');

test('audit: every page of a list reassembles into the original', () => {
  const data = Array.from({ length: 23 }, (_, i) => i);
  const joined = [];
  const pages = paginate(data, 1, 5).totalPages;
  assert.equal(pages, 5);
  for (let p = 1; p <= pages; p++) joined.push(...paginate(data, p, 5).items);
  assert.deepEqual(joined, data);
});

test('audit: a single item per page and a page size of exactly the length', () => {
  assert.deepEqual(paginate(['a', 'b'], 2, 1), { items: ['b'], page: 2, perPage: 1, totalItems: 2, totalPages: 2, hasPrev: true, hasNext: false });
  assert.equal(paginate(['a', 'b'], 1, 2).hasNext, false);
});
