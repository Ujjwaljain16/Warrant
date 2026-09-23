'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('./bucket');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

test('audit: a fractional capacity', () => {
  const b = new TokenBucket(1.5, 1);
  assert.equal(b.tryTake(0), true);
  close(b.available(0), 0.5);
  close(b.available(10_000), 1.5);
});

test('audit: negative timestamps work like any other time', () => {
  const b = new TokenBucket(2, 1);
  assert.equal(b.tryTake(-5000, 2), true);
  close(b.available(-4000), 1);
});

test('audit: a second take at the same instant sees no refill', () => {
  const b = new TokenBucket(2, 1000);
  assert.equal(b.tryTake(0, 2), true);
  assert.equal(b.tryTake(0), false);
});

test('audit: refill after a failed take starts from the failed take time', () => {
  const b = new TokenBucket(1, 1);
  assert.equal(b.tryTake(0), true);
  assert.equal(b.tryTake(400), false);
  assert.equal(b.tryTake(900), false);
  assert.equal(b.tryTake(1000), true);
});
