'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Emitter } = require('./emitter');

test('audit: the same function registered with once and on', () => {
  const e = new Emitter();
  let n = 0;
  const f = () => n++;
  e.once('x', f);
  e.on('x', f);
  e.emit('x');
  e.emit('x');
  assert.equal(n, 3);
});

test('audit: off can remove a once listener before it runs', () => {
  const e = new Emitter();
  let n = 0;
  const f = () => n++;
  e.once('x', f);
  assert.equal(e.off('x', f), true);
  e.emit('x');
  assert.equal(n, 0);
});

test('audit: arguments are passed to every listener, including once', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (...a) => seen.push(a));
  e.once('x', (...a) => seen.push(a));
  e.emit('x', 1, 'two', { three: 3 });
  assert.deepEqual(seen, [[1, 'two', { three: 3 }], [1, 'two', { three: 3 }]]);
});

test('audit: a once listener that throws is already removed', () => {
  const e = new Emitter();
  e.once('x', () => { throw new Error('once-boom'); });
  assert.throws(() => e.emit('x'), /once-boom/);
  assert.equal(e.listenerCount('x'), 0);
  assert.equal(e.emit('x'), false);
});

test('audit: listeners that unsubscribe themselves during emit', () => {
  const e = new Emitter();
  const seen = [];
  let un;
  un = e.on('x', () => { seen.push('self'); un(); });
  e.on('x', () => seen.push('other'));
  e.emit('x');
  e.emit('x');
  assert.deepEqual(seen, ['self', 'other', 'other']);
});
