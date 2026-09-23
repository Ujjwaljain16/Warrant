'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver } = require('./semver');

test('audit: very large components are compared exactly', () => {
  assert.equal(compareSemver('1.0.99999999999999999999', '1.0.99999999999999999998'), 1);
  assert.equal(compareSemver('1.0.0-99999999999999999998', '1.0.0-99999999999999999999'), -1);
});

test('audit: zero is a valid component and a valid numeric identifier', () => {
  assert.equal(compareSemver('0.0.0', '0.0.0-0'), 1);
  assert.equal(compareSemver('1.0.0-0', '1.0.0-0.0'), -1);
});

test('audit: identifiers with digits and letters mixed are text', () => {
  assert.equal(compareSemver('1.0.0-1a', '1.0.0-2'), 1);
  assert.equal(compareSemver('1.0.0-10a', '1.0.0-9a'), -1);
});

test('audit: antisymmetry on a sample', () => {
  const vs = ['0.1.0', '1.0.0-0', '1.0.0-a', '1.0.0-a.1', '1.0.0', '1.0.1', '1.1.0-rc', '2.0.0'];
  for (const x of vs) for (const y of vs) assert.equal(compareSemver(x, y), -compareSemver(y, x) || 0);
});

test('audit: trailing hyphens and digits inside identifiers', () => {
  assert.equal(compareSemver('1.0.0-a-', '1.0.0-a'), 1);
  assert.equal(compareSemver('1.0.0-0a', '1.0.0-1'), 1);
});
