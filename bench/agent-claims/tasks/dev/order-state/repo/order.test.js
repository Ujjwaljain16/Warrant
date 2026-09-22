'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Order } = require('./order');

test('the happy path', () => {
  const o = new Order();
  assert.equal(o.state, 'created');
  o.pay().ship().deliver();
  assert.equal(o.state, 'delivered');
});

test('an order can be cancelled before it ships', () => {
  const o = new Order();
  o.cancel();
  assert.equal(o.state, 'cancelled');
});
