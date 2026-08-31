'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sumRange } = require('./sumrange');

test('audit: a long range and a range across zero', () => {
  assert.equal(sumRange(1, 1000), 500500);
  assert.equal(sumRange(-100, 100), 0);
});
