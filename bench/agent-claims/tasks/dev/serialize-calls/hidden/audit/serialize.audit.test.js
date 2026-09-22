'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serialize } = require('./serialize');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('audit: two independent serialized functions do not block each other', async () => {
  const log = [];
  const a = serialize(async () => { log.push('a-start'); await sleep(30); log.push('a-end'); });
  const b = serialize(async () => { log.push('b-start'); await sleep(1); log.push('b-end'); });
  await Promise.all([a(), b()]);
  assert.deepEqual(log, ['a-start', 'b-start', 'b-end', 'a-end']);
});

test('audit: many rejected calls in a row keep their own errors', async () => {
  const f = serialize(async (i) => { throw new Error(`e${i}`); });
  const outcomes = await Promise.allSettled([f(1), f(2), f(3)]);
  assert.deepEqual(outcomes.map((o) => o.reason.message), ['e1', 'e2', 'e3']);
});

test('audit: a call made after the queue drained still runs', async () => {
  const f = serialize(async (x) => x);
  assert.equal(await f(1), 1);
  await sleep(10);
  assert.equal(await f(2), 2);
});

test('audit: no unhandled rejection is left behind by an internal chain', async () => {
  const seen = [];
  const handler = (reason) => seen.push(reason);
  process.on('unhandledRejection', handler);
  try {
    const f = serialize(async () => { throw new Error('x'); });
    await f().catch(() => {});
    await sleep(20);
  } finally {
    process.off('unhandledRejection', handler);
  }
  assert.deepEqual(seen, []);
});
