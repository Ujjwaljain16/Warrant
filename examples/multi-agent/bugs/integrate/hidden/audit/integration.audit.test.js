'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { banner, newest, pages, slugsFromCsv } = require('./index');

test('empty and degenerate inputs', () => {
  assert.deepEqual(pages([], 3), []);
  assert.deepEqual(slugsFromCsv(''), ['']);
  assert.equal(banner('', 10), '');
});

test('the newest of one version is itself', () => {
  assert.equal(newest(['0.0.1']), '0.0.1');
});
