'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./semver');

test('orders by patch, minor and major as numbers', () => {
  assert.equal(compare('1.2.3', '1.2.4'), -1);
  assert.equal(compare('1.2.3', '1.2.3'), 0);
  assert.equal(compare('1.10.0', '1.9.0'), 1);
  assert.equal(compare('2.0.0', '10.0.0'), -1);
});

test('a pre-release is older than its release', () => {
  assert.equal(compare('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compare('1.0.0', '1.0.0-rc.1'), 1);
});

test('pre-release tags are compared identifier by identifier', () => {
  assert.equal(compare('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(compare('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
  assert.equal(compare('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compare('1.0.0-1', '1.0.0-alpha'), -1);
});

test('invalid versions are a TypeError', () => {
  for (const bad of ['abc', '1.2', '1.2.3.4', '01.2.3', '', 5, null]) {
    assert.throws(() => compare(bad, '1.0.0'), TypeError);
    assert.throws(() => compare('1.0.0', bad), TypeError);
  }
});
