'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('./bucket');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

test('refill is fractional', () => {
  const b = new TokenBucket(2, 2);
  assert.equal(b.tryTake(0, 2), true);
  close(b.available(0), 0);
  close(b.available(250), 0.5);
  assert.equal(b.tryTake(250), false);
  close(b.available(250), 0.5);
  assert.equal(b.tryTake(500), true);
  close(b.available(500), 0);
});

test('the bucket never holds more than its capacity', () => {
  const b = new TokenBucket(3, 10);
  assert.equal(b.tryTake(0), true);
  close(b.available(1_000_000), 3);
  assert.equal(b.tryTake(1_000_000, 3), true);
  assert.equal(b.tryTake(1_000_000), false);
});

test('a failed take consumes nothing', () => {
  const b = new TokenBucket(5, 1);
  assert.equal(b.tryTake(0, 4), true);
  assert.equal(b.tryTake(0, 2), false);
  close(b.available(0), 1);
  assert.equal(b.tryTake(0, 1), true);
});

test('taking several tokens at once; n larger than capacity is simply refused', () => {
  const b = new TokenBucket(5, 1);
  assert.equal(b.tryTake(0, 5), true);
  assert.equal(b.tryTake(5000, 5), true);
  assert.equal(b.tryTake(20000, 6), false);
  close(b.available(20000), 5);
});

test('the first call starts the clock; a huge first timestamp changes nothing', () => {
  const b = new TokenBucket(2, 1);
  assert.equal(b.tryTake(1_700_000_000_000, 2), true);
  assert.equal(b.tryTake(1_700_000_000_000), false);
  close(b.available(1_700_000_000_500), 0.5);
});

test('a clock that goes backwards neither refills nor loses time', () => {
  const b = new TokenBucket(2, 1);
  assert.equal(b.tryTake(10_000, 2), true);
  close(b.available(5_000), 0);
  assert.equal(b.tryTake(5_000), false);
  close(b.available(10_500), 0.5);
  close(b.available(11_000), 1);
});

test('available does not consume', () => {
  const b = new TokenBucket(1, 1);
  b.available(0);
  b.available(0);
  assert.equal(b.tryTake(0), true);
});

test('argument validation', () => {
  for (const bad of [0, -1, NaN, Infinity, '1', undefined, null]) {
    assert.throws(() => new TokenBucket(bad, 1), RangeError, `capacity ${bad}`);
    assert.throws(() => new TokenBucket(1, bad), RangeError, `rate ${bad}`);
  }
  const b = new TokenBucket(2, 1);
  for (const bad of [0, -1, 1.5, NaN, '1']) assert.throws(() => b.tryTake(0, bad), RangeError, String(bad));
  for (const bad of [NaN, Infinity, '5', null, undefined]) {
    assert.throws(() => b.tryTake(bad), TypeError);
    assert.throws(() => b.available(bad), TypeError);
  }
});
