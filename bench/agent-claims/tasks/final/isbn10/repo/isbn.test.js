'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidIsbn10 } = require('./isbn');

test('a valid number', () => {
  assert.equal(isValidIsbn10('0306406152'), true);
  assert.equal(isValidIsbn10('0-306-40615-2'), true);
});

test('a wrong check digit', () => {
  assert.equal(isValidIsbn10('0306406153'), false);
});
