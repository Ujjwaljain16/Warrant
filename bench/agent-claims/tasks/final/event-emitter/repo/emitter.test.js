'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Emitter } = require('./emitter');

test('listeners run in registration order with the arguments', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', (a, b) => seen.push(['first', a, b]));
  e.on('x', (a) => seen.push(['second', a]));
  assert.equal(e.emit('x', 1, 2), true);
  assert.deepEqual(seen, [['first', 1, 2], ['second', 1]]);
});

test('once runs one time', () => {
  const e = new Emitter();
  let n = 0;
  e.once('x', () => n++);
  e.emit('x');
  e.emit('x');
  assert.equal(n, 1);
});

test('emit reports whether anyone listened', () => {
  assert.equal(new Emitter().emit('nobody'), false);
});
