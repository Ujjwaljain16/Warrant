'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidIsbn10 } = require('./isbn');

test('audit: a sum that is divisible by 11 only because X was counted as 10', () => {
  assert.equal(isValidIsbn10('097522980X'), true);
  assert.equal(isValidIsbn10('0975229800'), false);
});

test('audit: exactly one check character in eleven is right for any nine digits', () => {
  for (const prefix of ['030640615', '123456789', '000000000', '987654321']) {
    const valid = [...'0123456789X'].filter((c) => isValidIsbn10(prefix + c));
    assert.equal(valid.length, 1, prefix);
  }
});

test('audit: all zeros', () => {
  assert.equal(isValidIsbn10('0000000000'), true);
});

test('audit: unicode digits and look-alikes are not accepted', () => {
  assert.equal(isValidIsbn10('٠٣٠٦٤٠٦١٥٢'), false);
  assert.equal(isValidIsbn10('0306406152 '), false);
});

test('audit: lower-case x is only valid at the end', () => {
  assert.equal(isValidIsbn10('0x06406152'), false);
});
