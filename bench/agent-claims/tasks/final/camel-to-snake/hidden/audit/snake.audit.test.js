'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { camelToSnake } = require('./snake');

test('audit: classic mixed identifiers', () => {
  assert.equal(camelToSnake('XMLHttpRequest'), 'xml_http_request');
  assert.equal(camelToSnake('getXMLFile'), 'get_xml_file');
  assert.equal(camelToSnake('getHTTPServer2'), 'get_http_server2');
});

test('audit: digit and capital alternation', () => {
  assert.equal(camelToSnake('a1B2c3D'), 'a1_b2c3_d');
  assert.equal(camelToSnake('v2Beta'), 'v2_beta');
});

test('audit: underscores at both ends', () => {
  assert.equal(camelToSnake('__initFoo__'), '__init_foo__');
  assert.equal(camelToSnake('_'), '_');
});

test('audit: a two-letter acronym followed by a word', () => {
  assert.equal(camelToSnake('ABcd'), 'a_bcd');
  assert.equal(camelToSnake('ioError'), 'io_error');
  assert.equal(camelToSnake('IOError'), 'io_error');
});
