'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Order } = require('./order');

const invalid = (fn) => assert.throws(fn, (e) => e instanceof Error && e.code === 'INVALID_TRANSITION');

test('out-of-order calls throw INVALID_TRANSITION', () => {
  invalid(() => new Order().ship());
  invalid(() => new Order().deliver());
  const paid = new Order().pay();
  invalid(() => paid.pay());
  invalid(() => paid.deliver());
});

test('a shipped or delivered order cannot be cancelled', () => {
  const shipped = new Order().pay().ship();
  invalid(() => shipped.cancel());
  const delivered = new Order().pay().ship().deliver();
  invalid(() => delivered.cancel());
});

test('a cancelled order accepts nothing, not even a second cancel', () => {
  const o = new Order().cancel();
  invalid(() => o.cancel());
  invalid(() => o.pay());
  invalid(() => o.ship());
  invalid(() => o.deliver());
});

test('a failed call changes nothing', () => {
  const o = new Order().pay();
  invalid(() => o.deliver());
  assert.equal(o.state, 'paid');
  assert.deepEqual(o.history, ['created', 'paid']);
});

test('cancel is allowed after payment', () => {
  const o = new Order().pay().cancel();
  assert.equal(o.state, 'cancelled');
  assert.deepEqual(o.history, ['created', 'paid', 'cancelled']);
});

test('history is a fresh copy each time', () => {
  const o = new Order();
  o.history.push('hacked');
  assert.deepEqual(o.history, ['created']);
  assert.notEqual(o.history, o.history);
});

test('successful calls return the order itself', () => {
  const o = new Order();
  assert.equal(o.pay(), o);
  assert.equal(o.ship(), o);
  assert.equal(o.deliver(), o);
});
