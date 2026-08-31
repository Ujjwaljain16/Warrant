'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sumRange } = require('./sumrange');

test('sums an inclusive range', () => {
  assert.equal(sumRange(1, 4), 10);
});
