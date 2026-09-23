'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('./pool');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('never more than limit in flight, and all results in order', async () => {
  let running = 0;
  let max = 0;
  const out = await pool([1, 2, 3, 4, 5, 6, 7], async (x) => {
    running++;
    max = Math.max(max, running);
    await sleep(5 + (x % 3) * 4);
    running--;
    return x * 10;
  }, 3);
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(max, 3);
});

test('a freed slot is reused at once, not at the end of a batch', async () => {
  const events = [];
  const durations = { A: 60, B: 5, C: 5, D: 5 };
  await pool(['A', 'B', 'C', 'D'], async (name) => {
    events.push(`start ${name}`);
    await sleep(durations[name]);
    events.push(`end ${name}`);
  }, 2);
  assert.deepEqual(events, ['start A', 'start B', 'end B', 'start C', 'end C', 'start D', 'end D', 'end A']);
});

test('jobs start in input order and receive their index', async () => {
  const started = [];
  await pool(['a', 'b', 'c', 'd'], async (item, index) => { started.push([item, index]); await sleep(1); }, 2);
  assert.deepEqual(started, [['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
});

test('a limit larger than the list starts everything at once', async () => {
  let running = 0;
  let max = 0;
  await pool([1, 2, 3], async () => { running++; max = Math.max(max, running); await sleep(10); running--; }, 10);
  assert.equal(max, 3);
});

test('a rejection rejects the pool with the same error and stops new starts', async () => {
  const started = [];
  const boom = new Error('boom');
  await assert.rejects(
    pool([0, 1, 2, 3, 4, 5], async (x) => {
      started.push(x);
      if (x === 1) { await sleep(5); throw boom; }
      await sleep(40);
      return x;
    }, 2),
    (e) => e === boom,
  );
  await sleep(100);
  assert.deepEqual(started, [0, 1]);
});

test('a synchronous throw in the worker is a rejection too', async () => {
  const started = [];
  await assert.rejects(pool([1, 2, 3], (x) => { started.push(x); if (x === 1) throw new RangeError('sync'); return x; }, 1), RangeError);
  await sleep(20);
  assert.deepEqual(started, [1]);
});

test('workers may return plain values', async () => {
  assert.deepEqual(await pool([1, 2, 3], (x) => x + 1, 2), [2, 3, 4]);
});

test('invalid arguments reject, they do not throw synchronously', async () => {
  let promise;
  assert.doesNotThrow(() => { promise = pool('abc', () => {}, 1); });
  await assert.rejects(promise, TypeError);
  await assert.rejects(pool([1], 'nope', 1), TypeError);
  for (const bad of [0, -1, 1.5, NaN, '2', undefined, Infinity]) await assert.rejects(pool([1], () => {}, bad), RangeError, String(bad));
});
