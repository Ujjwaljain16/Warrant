'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('fills a line up to the width', () => {
  assert.equal(wrap('aaa bbb ccc', 7), 'aaa bbb\nccc');
});

test('short text stays on one line', () => {
  assert.equal(wrap('hi there', 40), 'hi there');
});
