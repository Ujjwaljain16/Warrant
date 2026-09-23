'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('./roman');

test('toRoman on tricky values', () => {
  const cases = { 1: 'I', 3: 'III', 4: 'IV', 9: 'IX', 14: 'XIV', 40: 'XL', 90: 'XC', 400: 'CD', 900: 'CM', 1994: 'MCMXCIV', 2024: 'MMXXIV', 3888: 'MMMDCCCLXXXVIII', 3999: 'MMMCMXCIX' };
  for (const [n, expected] of Object.entries(cases)) assert.equal(toRoman(Number(n)), expected, n);
});

test('toRoman range checks', () => {
  for (const bad of [0, -1, 4000, 1.5, NaN, Infinity, '5', null, undefined]) assert.throws(() => toRoman(bad), RangeError, String(bad));
});

test('fromRoman rejects non-canonical numerals with SyntaxError', () => {
  for (const bad of ['', 'IIII', 'VV', 'VX', 'IC', 'IL', 'XM', 'MMMM', 'IIV', 'IXI', 'XXXX', 'CMC', 'iv', ' X', 'X ', 'ABC', 'IVX', 'DD', 'LL', 'VIV']) {
    assert.throws(() => fromRoman(bad), SyntaxError, JSON.stringify(bad));
  }
});

test('fromRoman accepts the canonical forms', () => {
  assert.equal(fromRoman('I'), 1);
  assert.equal(fromRoman('IX'), 9);
  assert.equal(fromRoman('MMMCMXCIX'), 3999);
  assert.equal(fromRoman('MMXXIV'), 2024);
});

test('every value round-trips', () => {
  for (let n = 1; n <= 3999; n++) assert.equal(fromRoman(toRoman(n)), n);
});

test('fromRoman of a non-string is a TypeError', () => {
  for (const bad of [null, undefined, 5, ['X']]) assert.throws(() => fromRoman(bad), TypeError);
});
