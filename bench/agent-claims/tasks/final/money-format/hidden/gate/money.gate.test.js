'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('./money');

test('negative amounts put the sign before the symbol', () => {
  assert.equal(formatMoney(-5), '-$0.05');
  assert.equal(formatMoney(-123456789), '-$1,234,567.89');
  assert.equal(formatMoney(-100, 'GBP'), '-£1.00');
});

test('thousands separators in every group size', () => {
  assert.equal(formatMoney(99999), '$999.99');
  assert.equal(formatMoney(100000), '$1,000.00');
  assert.equal(formatMoney(99999999), '$999,999.99');
  assert.equal(formatMoney(100000000), '$1,000,000.00');
});

test('two decimals are always shown', () => {
  assert.equal(formatMoney(100), '$1.00');
  assert.equal(formatMoney(110), '$1.10');
  assert.equal(formatMoney(99), '$0.99');
  assert.equal(formatMoney(1), '$0.01');
});

test('yen has no decimals', () => {
  assert.equal(formatMoney(1234567, 'JPY'), '¥1,234,567');
  assert.equal(formatMoney(-5, 'JPY'), '-¥5');
  assert.equal(formatMoney(0, 'JPY'), '¥0');
  assert.equal(formatMoney(999, 'JPY'), '¥999');
});

test('the other currencies', () => {
  assert.equal(formatMoney(250, 'GBP'), '£2.50');
  assert.equal(formatMoney(1234, 'EUR'), '€12.34');
});

test('large safe integers are exact', () => {
  assert.equal(formatMoney(9007199254740991), '$90,071,992,547,409.91');
  assert.equal(formatMoney(-9007199254740991, 'JPY'), '-¥9,007,199,254,740,991');
});

test('negative zero is zero', () => {
  assert.equal(formatMoney(-0), '$0.00');
});

test('invalid amounts', () => {
  for (const bad of [1.5, NaN, Infinity, -Infinity, '5', null, undefined, 2 ** 53, 10 ** 20]) assert.throws(() => formatMoney(bad), RangeError, String(bad));
});

test('unknown currencies, including inherited property names', () => {
  for (const bad of ['XYZ', 'usd', 'toString', 'constructor', '__proto__', '', 5, null]) assert.throws(() => formatMoney(100, bad), RangeError, String(bad));
});
