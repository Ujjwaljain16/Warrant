'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('./roman');

test('toRoman', () => {
  assert.equal(toRoman(4), 'IV');
  assert.equal(toRoman(1994), 'MCMXCIV');
});

test('fromRoman', () => {
  assert.equal(fromRoman('XIV'), 14);
  assert.equal(fromRoman('MCMXCIV'), 1994);
});
