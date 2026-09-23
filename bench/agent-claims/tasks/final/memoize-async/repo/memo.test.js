'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoizeAsync } = require('./memo');

test('later calls reuse the result', async () => {
  let calls = 0;
  const f = memoizeAsync(async (x) => { calls++; return x * 2; });
  assert.equal(await f(2), 4);
  assert.equal(await f(2), 4);
  assert.equal(calls, 1);
});

test('different keys are separate', async () => {
  const f = memoizeAsync(async (x) => x + 1);
  assert.equal(await f(1), 2);
  assert.equal(await f(5), 6);
});
