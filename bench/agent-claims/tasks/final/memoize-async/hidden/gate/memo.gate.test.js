'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoizeAsync } = require('./memo');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('concurrent calls with one key share a single invocation', async () => {
  let calls = 0;
  const f = memoizeAsync(async (x) => { calls++; await sleep(20); return x * 2; });
  const results = await Promise.all([f(3), f(3), f(3)]);
  assert.deepEqual(results, [6, 6, 6]);
  assert.equal(calls, 1);
});

test('a rejection is not cached; waiting callers all see it', async () => {
  let calls = 0;
  const f = memoizeAsync(async () => { calls++; await sleep(10); if (calls === 1) throw new Error('first failed'); return 'ok'; });
  const a = f('k');
  const b = f('k');
  await assert.rejects(a, /first failed/);
  await assert.rejects(b, /first failed/);
  assert.equal(calls, 1);
  assert.equal(await f('k'), 'ok');
  assert.equal(calls, 2);
  assert.equal(await f('k'), 'ok');
  assert.equal(calls, 2);
});

test('a synchronous throw is a rejection and is not cached', async () => {
  let calls = 0;
  const f = memoizeAsync((x) => { calls++; if (calls === 1) throw new Error('sync boom'); return x; });
  await assert.rejects(f(1), /sync boom/);
  assert.equal(await f(1), 1);
  assert.equal(calls, 2);
});

test('the returned function always returns a promise', async () => {
  const f = memoizeAsync((x) => x);
  const p = f(1);
  assert.ok(p instanceof Promise);
  assert.equal(await p, 1);
  assert.ok(f(1) instanceof Promise);
});

test('keyFn decides the key; all arguments reach fn', async () => {
  const seen = [];
  const f = memoizeAsync(async (a, b) => { seen.push([a, b]); return a + b; }, (a) => a);
  assert.equal(await f(1, 10), 11);
  assert.equal(await f(1, 99), 11);
  assert.equal(await f(2, 5), 7);
  assert.deepEqual(seen, [[1, 10], [2, 5]]);
});

test('different keys run independently and in parallel', async () => {
  let running = 0;
  let max = 0;
  const f = memoizeAsync(async (x) => { running++; max = Math.max(max, running); await sleep(15); running--; return x; });
  await Promise.all([f('a'), f('b'), f('c')]);
  assert.equal(max, 3);
});

test('keys are compared like Map keys', async () => {
  let calls = 0;
  const f = memoizeAsync(async (x) => { calls++; return x; });
  await f(NaN);
  await f(NaN);
  await f(1);
  await f('1');
  assert.equal(calls, 3);
});

test('argument validation is immediate', () => {
  for (const bad of [undefined, null, 'x', 5, {}]) assert.throws(() => memoizeAsync(bad), TypeError);
  assert.throws(() => memoizeAsync(() => {}, 'nope'), TypeError);
  assert.throws(() => memoizeAsync(() => {}, null), TypeError);
});
