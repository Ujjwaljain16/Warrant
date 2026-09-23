'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoizeAsync } = require('./memo');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('audit: a cached undefined result is still cached', async () => {
  let calls = 0;
  const f = memoizeAsync(async () => { calls++; });
  await f('k');
  await f('k');
  assert.equal(calls, 1);
});

test('audit: failure of one key does not disturb another', async () => {
  const f = memoizeAsync(async (k) => { await sleep(5); if (k === 'bad') throw new Error('bad'); return k; });
  const [good, bad] = await Promise.allSettled([f('good'), f('bad')]);
  assert.equal(good.status, 'fulfilled');
  assert.equal(bad.status, 'rejected');
  assert.equal(await f('good'), 'good');
});

test('audit: a retry after failure while the first failure is still being observed', async () => {
  let calls = 0;
  const f = memoizeAsync(async () => { calls++; await sleep(5); if (calls === 1) throw new Error('x'); return calls; });
  await assert.rejects(f('k'));
  const [a, b] = await Promise.all([f('k'), f('k')]);
  assert.equal(a, 2);
  assert.equal(b, 2);
  assert.equal(calls, 2);
});

test('audit: no unhandled rejection is produced by the cache bookkeeping', async () => {
  const seen = [];
  const handler = (reason) => seen.push(reason);
  process.on('unhandledRejection', handler);
  try {
    const f = memoizeAsync(async () => { throw new Error('x'); });
    await f('k').catch(() => {});
    await sleep(20);
  } finally {
    process.off('unhandledRejection', handler);
  }
  assert.deepEqual(seen, []);
});

test('audit: default key is the first argument only', async () => {
  let calls = 0;
  const f = memoizeAsync(async (a) => { calls++; return a; });
  await f(1, 'x');
  await f(1, 'y');
  assert.equal(calls, 1);
});
