'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { camelToSnake } = require('./snake');

test('simple camelCase', () => {
  assert.equal(camelToSnake('fooBar'), 'foo_bar');
  assert.equal(camelToSnake('camelCaseString'), 'camel_case_string');
});

test('already lower-case', () => {
  assert.equal(camelToSnake('simple'), 'simple');
});
