'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./semver');

test('is consistent on a mixed, sorted list', () => {
  const list = ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0', '1.0.1', '1.10.0'];
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) assert.equal(compare(list[i], list[j]), Math.sign(i - j));
  }
});
