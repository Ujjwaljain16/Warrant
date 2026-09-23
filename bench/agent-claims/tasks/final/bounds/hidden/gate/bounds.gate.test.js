'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lowerBound, upperBound } = require('./bounds');

test('a target beyond the last element', () => {
  assert.equal(lowerBound([1, 3, 5], 6), 3);
  assert.equal(upperBound([1, 3, 5], 6), 3);
  assert.equal(upperBound([1, 3, 5], 5), 3);
});

test('a target before the first element', () => {
  assert.equal(lowerBound([1, 3, 5], 0), 0);
  assert.equal(upperBound([1, 3, 5], 0), 0);
});

test('duplicates', () => {
  const a = [1, 2, 2, 2, 3];
  assert.equal(lowerBound(a, 2), 1);
  assert.equal(upperBound(a, 2), 4);
  const b = [4, 4, 4];
  assert.equal(lowerBound(b, 4), 0);
  assert.equal(upperBound(b, 4), 3);
});

test('an empty array', () => {
  assert.equal(lowerBound([], 1), 0);
  assert.equal(upperBound([], 1), 0);
});

test('one element', () => {
  assert.equal(lowerBound([5], 5), 0);
  assert.equal(upperBound([5], 5), 1);
  assert.equal(lowerBound([5], 6), 1);
  assert.equal(lowerBound([5], 4), 0);
});

test('reads at most 64 elements of a million', () => {
  const data = Array.from({ length: 1_000_000 }, (_, i) => i * 2);
  for (const fn of [lowerBound, upperBound]) {
    for (const x of [-1, 0, 777, 999_998, 1_999_999]) {
      let reads = 0;
      const proxy = new Proxy(data, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
      fn(proxy, x);
      assert.ok(reads <= 64, `${fn.name}(${x}) read ${reads} elements`);
    }
  }
});

test('argument types', () => {
  for (const bad of ['abc', null, undefined, { length: 1 }]) assert.throws(() => lowerBound(bad, 1), TypeError);
  for (const bad of [NaN, '1', null, undefined]) {
    assert.throws(() => lowerBound([1, 2], bad), TypeError);
    assert.throws(() => upperBound([1, 2], bad), TypeError);
  }
});

test('the input is not modified', () => {
  const a = [1, 2, 3];
  lowerBound(a, 2);
  upperBound(a, 2);
  assert.deepEqual(a, [1, 2, 3]);
});
