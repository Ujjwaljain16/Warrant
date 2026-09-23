'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Emitter } = require('./emitter');

test('a once listener does not make the next listener skip', () => {
  const e = new Emitter();
  const seen = [];
  e.once('x', () => seen.push('once'));
  e.on('x', () => seen.push('second'));
  e.on('x', () => seen.push('third'));
  e.emit('x');
  assert.deepEqual(seen, ['once', 'second', 'third']);
  seen.length = 0;
  e.emit('x');
  assert.deepEqual(seen, ['second', 'third']);
});

test('a listener added during emit waits for the next emit', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', () => { seen.push('a'); e.on('x', () => seen.push('late')); });
  e.emit('x');
  assert.deepEqual(seen, ['a']);
  seen.length = 0;
  e.emit('x');
  assert.deepEqual(seen, ['a', 'late']);
});

test('a listener removed during emit still runs in that emit', () => {
  const e = new Emitter();
  const seen = [];
  const second = () => seen.push('second');
  e.on('x', () => { seen.push('first'); e.off('x', second); });
  e.on('x', second);
  e.emit('x');
  assert.deepEqual(seen, ['first', 'second']);
  seen.length = 0;
  e.emit('x');
  assert.deepEqual(seen, ['first']);
});

test('a once listener never runs twice, even if it emits the same event', () => {
  const e = new Emitter();
  let n = 0;
  e.once('x', () => { n++; if (n < 5) e.emit('x'); });
  e.emit('x');
  assert.equal(n, 1);
});

test('off removes one registration, the earliest', () => {
  const e = new Emitter();
  const seen = [];
  const f = () => seen.push('f');
  e.on('x', f);
  e.on('x', () => seen.push('g'));
  e.on('x', f);
  assert.equal(e.listenerCount('x'), 3);
  assert.equal(e.off('x', f), true);
  assert.equal(e.listenerCount('x'), 2);
  e.emit('x');
  assert.deepEqual(seen, ['g', 'f']);
  assert.equal(e.off('x', () => {}), false);
  assert.equal(e.off('nothing', f), false);
});

test('unsubscribe functions remove exactly their own registration, once', () => {
  const e = new Emitter();
  const seen = [];
  const f = () => seen.push('f');
  const un1 = e.on('x', f);
  e.on('x', f);
  assert.equal(un1(), undefined);
  un1();
  assert.equal(e.listenerCount('x'), 1);
  const unOnce = e.once('y', f);
  unOnce();
  assert.equal(e.emit('y'), false);
});

test('a throwing listener stops the emit and propagates', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', () => seen.push(1));
  e.on('x', () => { throw new Error('boom'); });
  e.on('x', () => seen.push(3));
  assert.throws(() => e.emit('x'), /boom/);
  assert.deepEqual(seen, [1]);
});

test('events are independent and emit reports listeners', () => {
  const e = new Emitter();
  e.on('a', () => {});
  assert.equal(e.emit('a'), true);
  assert.equal(e.emit('b'), false);
  assert.equal(e.listenerCount('b'), 0);
});

test('argument types', () => {
  const e = new Emitter();
  for (const bad of [null, undefined, 'x', 5]) {
    assert.throws(() => e.on('x', bad), TypeError);
    assert.throws(() => e.once('x', bad), TypeError);
  }
  for (const bad of [null, undefined, 5]) assert.throws(() => e.on(bad, () => {}), TypeError);
});
