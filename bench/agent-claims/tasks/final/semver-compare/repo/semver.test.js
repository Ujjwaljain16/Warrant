'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver } = require('./semver');

test('compares release versions numerically', () => {
  assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.10.0', '1.9.0'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});
