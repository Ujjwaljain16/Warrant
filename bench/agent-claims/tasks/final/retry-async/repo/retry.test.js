'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('./retry');

test('resolves with the first success', async () => {
  assert.equal(await retry(async () => 'ok', { sleep: async () => {} }), 'ok');
});

test('retries until it works', async () => {
  let calls = 0;
  const value = await retry(async () => { calls++; if (calls < 3) throw new Error('no'); return calls; }, { sleep: async () => {} });
  assert.equal(value, 3);
});
