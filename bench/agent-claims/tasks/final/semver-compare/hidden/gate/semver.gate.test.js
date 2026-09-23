'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver } = require('./semver');

test('a pre-release is lower than its release', () => {
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 1);
});

test('the ascending chain of pre-release precedence', () => {
  const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i < chain.length; i++) {
    for (let j = 0; j < chain.length; j++) {
      assert.equal(compareSemver(chain[i], chain[j]), Math.sign(i - j), `${chain[i]} vs ${chain[j]}`);
    }
  }
});

test('numeric identifiers are compared as numbers, text as ASCII', () => {
  assert.equal(compareSemver('1.0.0-2', '1.0.0-10'), -1);
  assert.equal(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10'), -1);
  assert.equal(compareSemver('1.0.0-B', '1.0.0-a'), -1);
  assert.equal(compareSemver('1.0.0-1', '1.0.0-a'), -1);
  assert.equal(compareSemver('1.0.0-a-b', '1.0.0-a'), 1);
});

test('build metadata is ignored', () => {
  assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
  assert.equal(compareSemver('1.0.0-rc.1+build.5', '1.0.0-rc.1'), 0);
  assert.equal(compareSemver('1.0.1+z', '1.0.0+a'), 1);
});

test('core versions are compared numerically left to right', () => {
  assert.equal(compareSemver('1.9.0', '1.10.0'), -1);
  assert.equal(compareSemver('2.0.0', '10.0.0'), -1);
  assert.equal(compareSemver('1.0.10', '1.0.9'), 1);
  assert.equal(compareSemver('0.0.1', '0.0.1'), 0);
});

test('invalid versions throw SyntaxError', () => {
  for (const bad of ['', '1', '1.2', '1.2.3.4', 'v1.2.3', ' 1.2.3', '1.2.3 ', '01.2.3', '1.02.3', '1.2.03', '1.2.3-', '1.2.3-01', '1.2.3-a..b', '1.2.3+', '1.2.3-a_b', '-1.2.3', '1.2.x']) {
    assert.throws(() => compareSemver(bad, '1.0.0'), SyntaxError, JSON.stringify(bad));
    assert.throws(() => compareSemver('1.0.0', bad), SyntaxError, JSON.stringify(bad));
  }
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 1, ['1.0.0']]) {
    assert.throws(() => compareSemver(bad, '1.0.0'), TypeError);
    assert.throws(() => compareSemver('1.0.0', bad), TypeError);
  }
});
