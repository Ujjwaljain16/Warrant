'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Order } = require('./order');

test('audit: independent orders do not share state or history', () => {
  const a = new Order().pay();
  const b = new Order();
  assert.equal(b.state, 'created');
  assert.deepEqual(b.history, ['created']);
  assert.deepEqual(a.history, ['created', 'paid']);
});

test('audit: the error is an Error with the code and a message', () => {
  try {
    new Order().ship();
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.equal(e.code, 'INVALID_TRANSITION');
    assert.equal(typeof e.message, 'string');
    assert.ok(e.message.length > 0);
  }
});

test('audit: full history of the happy path', () => {
  const o = new Order().pay().ship().deliver();
  assert.deepEqual(o.history, ['created', 'paid', 'shipped', 'delivered']);
  assert.throws(() => o.pay(), (e) => e.code === 'INVALID_TRANSITION');
  assert.deepEqual(o.history, ['created', 'paid', 'shipped', 'delivered']);
});
