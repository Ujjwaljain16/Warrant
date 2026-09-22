'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serialize } = require('./serialize');

test('returns each call\'s own result', async () => {
  const double = serialize(async (x) => x * 2);
  assert.deepEqual(await Promise.all([double(1), double(2), double(3)]), [2, 4, 6]);
});

test('a synchronous function works too', async () => {
  const inc = serialize((x) => x + 1);
  assert.equal(await inc(1), 2);
});
