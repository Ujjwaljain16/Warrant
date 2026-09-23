'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('./pool');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('audit: limit 1 runs strictly one after another', async () => {
  const events = [];
  await pool([1, 2, 3], async (x) => { events.push(`s${x}`); await sleep(5); events.push(`e${x}`); }, 1);
  assert.deepEqual(events, ['s1', 'e1', 's2', 'e2', 's3', 'e3']);
});

test('audit: a failure after a slow success still rejects, and a later failure does not change the first error', async () => {
  const first = new Error('first');
  await assert.rejects(pool([1, 2, 3], async (x) => {
    if (x === 1) { await sleep(40); throw new Error('second'); }
    if (x === 2) { await sleep(5); throw first; }
    return x;
  }, 3), (e) => e === first);
});

test('audit: the results array holds undefined for jobs that return nothing, and the right length', async () => {
  const out = await pool([1, 2, 3], async () => {}, 2);
  assert.deepEqual(out, [undefined, undefined, undefined]);
  assert.equal(out.length, 3);
});

test('audit: many quick jobs finish and keep order', async () => {
  const items = Array.from({ length: 300 }, (_, i) => i);
  const out = await pool(items, async (x) => { if (x % 7 === 0) await sleep(1); return x * 2; }, 8);
  assert.deepEqual(out, items.map((x) => x * 2));
});

test('audit: the input array is not modified', async () => {
  const items = [3, 2, 1];
  await pool(items, async (x) => x, 2);
  assert.deepEqual(items, [3, 2, 1]);
});

test('audit: no unhandled rejection from jobs that fail after the pool already rejected', async () => {
  const seen = [];
  const handler = (reason) => seen.push(reason);
  process.on('unhandledRejection', handler);
  try {
    await assert.rejects(pool([1, 2], async (x) => { if (x === 1) throw new Error('a'); await sleep(10); throw new Error('b'); }, 2));
    await sleep(40);
  } finally {
    process.off('unhandledRejection', handler);
  }
  assert.deepEqual(seen, []);
});
