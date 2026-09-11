'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./semver');

test('orders by patch', () => {
  assert.equal(compare('1.2.3', '1.2.4'), -1);
  assert.equal(compare('1.2.3', '1.2.3'), 0);
});

test('compares numbers, not text', () => {
  assert.equal(compare('1.10.0', '1.9.0'), 1);
});
