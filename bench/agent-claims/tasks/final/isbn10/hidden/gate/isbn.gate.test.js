'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidIsbn10 } = require('./isbn');

test('X as the check character', () => {
  assert.equal(isValidIsbn10('080442957X'), true);
  assert.equal(isValidIsbn10('0-8044-2957-X'), true);
  assert.equal(isValidIsbn10('097522980X'), true);
  assert.equal(isValidIsbn10('080442957x'), true);
});

test('X anywhere else is invalid', () => {
  assert.equal(isValidIsbn10('0X06406152'), false);
  assert.equal(isValidIsbn10('X306406152'), false);
  assert.equal(isValidIsbn10('XXXXXXXXXX'), false);
});

test('the check is the weighted sum modulo 11', () => {
  assert.equal(isValidIsbn10('0306406152'), true);
  assert.equal(isValidIsbn10('0306406151'), false);
  assert.equal(isValidIsbn10('0306406150'), false);
  assert.equal(isValidIsbn10('080442957'), false);
  assert.equal(isValidIsbn10('0804429570'), false);
});

test('length is exactly ten after removing separators', () => {
  assert.equal(isValidIsbn10('030640615'), false);
  assert.equal(isValidIsbn10('03064061520'), false);
  assert.equal(isValidIsbn10(''), false);
  assert.equal(isValidIsbn10('-- --'), false);
});

test('other characters are invalid', () => {
  assert.equal(isValidIsbn10('03064O6152'), false);
  assert.equal(isValidIsbn10('0306406152a'), false);
  assert.equal(isValidIsbn10('0306.406152'), false);
  assert.equal(isValidIsbn10('0306\t406152'), false);
  assert.equal(isValidIsbn10('abcdefghij'), false);
});

test('separators may appear anywhere', () => {
  assert.equal(isValidIsbn10('0 306 4061-52'), true);
  assert.equal(isValidIsbn10(' 0306406152 '), true);
  assert.equal(isValidIsbn10('-0-3-0-6-4-0-6-1-5-2-'), true);
});

test('non-strings throw TypeError', () => {
  for (const bad of [null, undefined, 306406152, ['0306406152']]) assert.throws(() => isValidIsbn10(bad), TypeError);
});
