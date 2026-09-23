'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { camelToSnake } = require('./snake');

test('acronyms are one word', () => {
  assert.equal(camelToSnake('parseHTTPResponse'), 'parse_http_response');
  assert.equal(camelToSnake('HTTPServer'), 'http_server');
  assert.equal(camelToSnake('ABTest'), 'ab_test');
  assert.equal(camelToSnake('parseHTTP'), 'parse_http');
  assert.equal(camelToSnake('HTTP'), 'http');
});

test('a leading capital does not add a leading underscore', () => {
  assert.equal(camelToSnake('Foo'), 'foo');
  assert.equal(camelToSnake('FooBar'), 'foo_bar');
  assert.equal(camelToSnake('A'), 'a');
});

test('digits stay with the letters before them', () => {
  assert.equal(camelToSnake('sha256'), 'sha256');
  assert.equal(camelToSnake('utf8Decode'), 'utf8_decode');
  assert.equal(camelToSnake('html5Parser'), 'html5_parser');
  assert.equal(camelToSnake('ABC123def'), 'abc123def');
  assert.equal(camelToSnake('ABC123Def'), 'abc123_def');
});

test('existing underscores are kept and never doubled', () => {
  assert.equal(camelToSnake('foo_Bar'), 'foo_bar');
  assert.equal(camelToSnake('_privateField'), '_private_field');
  assert.equal(camelToSnake('already_snake_case'), 'already_snake_case');
});

test('empty string and non-strings', () => {
  assert.equal(camelToSnake(''), '');
  for (const bad of [null, undefined, 5, ['a']]) assert.throws(() => camelToSnake(bad), TypeError);
});
