'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uniqueBy } = require('./uniqueby');

test('NaN is a single key', () => {
  assert.equal(uniqueBy([NaN, 1, NaN]).length, 2);
  assert.deepEqual(uniqueBy([1, NaN, 2, NaN]).map(String), ['1', 'NaN', '2']);
});

test('0 and -0 are the same key', () => {
  const out = uniqueBy([0, -0, 1]);
  assert.equal(out.length, 2);
  assert.ok(Object.is(out[0], 0));
});

test('keyFn is called once per item with (item, index)', () => {
  const calls = [];
  uniqueBy(['a', 'b', 'a'], (item, index) => { calls.push([item, index]); return item; });
  assert.deepEqual(calls, [['a', 0], ['b', 1], ['a', 2]]);
});

test('objects are equal only to themselves', () => {
  const a = { x: 1 };
  assert.equal(uniqueBy([a, a, { x: 1 }]).length, 2);
});

test('the input is not modified and the result is a new array', () => {
  const input = [3, 3, 1];
  const out = uniqueBy(input);
  assert.deepEqual(input, [3, 3, 1]);
  assert.notEqual(out, input);
  assert.deepEqual(uniqueBy([]), []);
});

test('argument types', () => {
  for (const bad of [null, 'abc', {}, undefined]) assert.throws(() => uniqueBy(bad), TypeError);
  assert.throws(() => uniqueBy([1], 'nope'), TypeError);
  assert.throws(() => uniqueBy([1], null), TypeError);
});
