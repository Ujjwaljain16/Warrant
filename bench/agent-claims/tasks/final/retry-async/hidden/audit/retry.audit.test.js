'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('./retry');

test('audit: a fractional factor above 1', async () => {
  const delays = [];
  await assert.rejects(retry(async () => { throw new Error('x'); }, { retries: 3, delayMs: 100, factor: 1.5, sleep: async (ms) => { delays.push(ms); } }));
  assert.deepEqual(delays, [100, 150, 225]);
});

test('audit: the sleep function is awaited before the next attempt', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const promise = retry(async (attempt) => { order.push(`attempt ${attempt}`); if (attempt === 1) throw new Error('x'); return 'ok'; }, { sleep: async () => { order.push('sleep start'); await gate; order.push('sleep end'); } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['attempt 1', 'sleep start']);
  release();
  assert.equal(await promise, 'ok');
  assert.deepEqual(order, ['attempt 1', 'sleep start', 'sleep end', 'attempt 2']);
});

test('audit: non-Error rejections are passed through unchanged', async () => {
  const thrown = { code: 42 };
  await assert.rejects(retry(async () => { throw thrown; }, { retries: 1, sleep: async () => {} }), (e) => e === thrown);
});

test('audit: the real timer works for small delays', async () => {
  let calls = 0;
  const start = Date.now();
  const value = await retry(async () => { calls++; if (calls < 2) throw new Error('x'); return 'ok'; }, { delayMs: 30 });
  assert.equal(value, 'ok');
  assert.ok(Date.now() - start >= 25);
});

test('audit: the options object is not modified', async () => {
  const options = { retries: 1, sleep: async () => {} };
  const snapshot = { ...options };
  await retry(async () => 1, options);
  assert.deepEqual(Object.keys(options), Object.keys(snapshot));
  assert.equal(options.retries, 1);
});
