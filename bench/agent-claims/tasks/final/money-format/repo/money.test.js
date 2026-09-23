'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('./money');

test('dollars and cents', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(0), '$0.00');
});

test('other currencies', () => {
  assert.equal(formatMoney(1999, 'EUR'), '€19.99');
});
