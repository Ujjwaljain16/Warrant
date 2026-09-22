'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serialize } = require('./serialize');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('calls never overlap and start in call order', async () => {
  const events = [];
  let running = 0;
  let maxRunning = 0;
  const work = serialize(async (name, ms) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    events.push(`start ${name}`);
    await sleep(ms);
    events.push(`end ${name}`);
    running--;
    return name;
  });
  const results = await Promise.all([work('a', 30), work('b', 1), work('c', 10)]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.equal(maxRunning, 1);
  assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a rejection does not stop later calls', async () => {
  const f = serialize(async (x) => { if (x === 'bad') throw new Error('boom'); return x; });
  const p1 = f('ok1');
  const p2 = f('bad');
  const p3 = f('ok2');
  assert.equal(await p1, 'ok1');
  await assert.rejects(p2, /boom/);
  assert.equal(await p3, 'ok2');
});

test('a synchronous throw becomes a rejection and the queue survives', async () => {
  const f = serialize((x) => { if (x < 0) throw new RangeError('neg'); return x; });
  await assert.rejects(f(-1), RangeError);
  assert.equal(await f(2), 2);
});

test('this and arguments are passed through', async () => {
  const obj = { base: 10, add: serialize(function add(a, b) { return this.base + a + b; }) };
  assert.equal(await obj.add(1, 2), 13);
});

test('fn is not called until its turn, and the wrapper itself never throws synchronously', async () => {
  let calls = 0;
  const f = serialize(async () => { calls++; await sleep(15); });
  const p1 = f();
  const p2 = f();
  await sleep(1);
  assert.equal(calls, 1);
  await Promise.all([p1, p2]);
  assert.equal(calls, 2);
});

test('serialize validates fn immediately', () => {
  for (const bad of [undefined, null, 'x', {}, 5]) assert.throws(() => serialize(bad), TypeError);
});
