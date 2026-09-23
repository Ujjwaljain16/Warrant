'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('./bucket');

test('a full bucket allows a burst, then refuses', () => {
  const b = new TokenBucket(3, 1);
  assert.equal(b.tryTake(0), true);
  assert.equal(b.tryTake(0), true);
  assert.equal(b.tryTake(0), true);
  assert.equal(b.tryTake(0), false);
});

test('tokens come back over time', () => {
  const b = new TokenBucket(1, 1);
  assert.equal(b.tryTake(0), true);
  assert.equal(b.tryTake(500), false);
  assert.equal(b.tryTake(1000), true);
});
