'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('./money');

test('audit: an explicit undefined currency means USD', () => {
  assert.equal(formatMoney(100, undefined), '$1.00');
});

test('audit: every amount from -2000 to 2000 matches an independent formatting', () => {
  for (let cents = -2000; cents <= 2000; cents++) {
    const abs = Math.abs(cents);
    const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const expected = (cents < 0 ? '-' : '') + '$' + dollars + '.' + String(abs % 100).padStart(2, '0');
    assert.equal(formatMoney(cents), expected);
  }
});

test('audit: group boundaries for yen', () => {
  for (const [amount, text] of [[999, '¥999'], [1000, '¥1,000'], [999999, '¥999,999'], [1000000, '¥1,000,000'], [12345678, '¥12,345,678']]) assert.equal(formatMoney(amount, 'JPY'), text);
});

test('audit: euro and pound sign placement for negative values', () => {
  assert.equal(formatMoney(-1, 'EUR'), '-€0.01');
  assert.equal(formatMoney(-123456, 'GBP'), '-£1,234.56');
});
