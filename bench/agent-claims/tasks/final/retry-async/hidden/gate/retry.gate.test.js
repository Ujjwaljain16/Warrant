'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('./retry');

const recorder = () => {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
};

test('exponential delays, retries + 1 attempts, no sleep after the last failure', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error(`fail ${calls}`); }, { retries: 3, delayMs: 100, factor: 2, sleep }), /fail 4/);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [100, 200, 400]);
});

test('default options: 3 retries, 100 ms, factor 2', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error('x'); }, { sleep }));
  assert.equal(calls, 4);
  assert.deepEqual(delays, [100, 200, 400]);
});

test('a success stops everything and passes the attempt number', async () => {
  const { delays, sleep } = recorder();
  const attempts = [];
  const value = await retry(async (attempt) => { attempts.push(attempt); if (attempt < 3) throw new Error('no'); return `done on ${attempt}`; }, { retries: 5, delayMs: 10, factor: 3, sleep });
  assert.equal(value, 'done on 3');
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [10, 30]);
});

test('success on the first attempt never sleeps', async () => {
  const { delays, sleep } = recorder();
  assert.equal(await retry(() => 'sync value', { sleep }), 'sync value');
  assert.deepEqual(delays, []);
});

test('retries of zero means a single attempt', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error('once'); }, { retries: 0, sleep }), /once/);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('a synchronous throw counts as a failed attempt', async () => {
  const { sleep } = recorder();
  let calls = 0;
  const value = await retry((attempt) => { calls++; if (attempt === 1) throw new Error('sync'); return 'fine'; }, { sleep });
  assert.equal(value, 'fine');
  assert.equal(calls, 2);
});

test('shouldRetry can stop early with the error of that attempt', async () => {
  const { delays, sleep } = recorder();
  const seen = [];
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw new Error(`e${calls}`); }, { retries: 5, sleep, shouldRetry: (error, attempt) => { seen.push([error.message, attempt]); return attempt < 2; } }),
    /e2/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(seen, [['e1', 1], ['e2', 2]]);
  assert.deepEqual(delays, [100]);
});

test('delayMs of 0 and factor 1', async () => {
  const { delays, sleep } = recorder();
  await assert.rejects(retry(async () => { throw new Error('x'); }, { retries: 2, delayMs: 0, sleep }));
  assert.deepEqual(delays, [0, 0]);
  const second = recorder();
  await assert.rejects(retry(async () => { throw new Error('x'); }, { retries: 3, delayMs: 50, factor: 1, sleep: second.sleep }));
  assert.deepEqual(second.delays, [50, 50, 50]);
});

test('invalid arguments reject', async () => {
  await assert.rejects(retry('nope'), TypeError);
  await assert.rejects(retry(undefined), TypeError);
  for (const retries of [-1, 1.5, NaN, '2', Infinity]) await assert.rejects(retry(async () => 1, { retries }), RangeError, `retries ${retries}`);
  for (const delayMs of [-1, NaN, Infinity, '5']) await assert.rejects(retry(async () => 1, { delayMs }), RangeError, `delayMs ${delayMs}`);
  for (const factor of [0.5, 0, NaN, Infinity, '2']) await assert.rejects(retry(async () => 1, { factor }), RangeError, `factor ${factor}`);
});
