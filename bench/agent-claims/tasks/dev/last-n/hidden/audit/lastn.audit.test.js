'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lastN } = require('./lastn');

test('audit: empty input with a positive n', () => {
  assert.deepEqual(lastN([], 3), []);
});

test('audit: elements are kept as they are (undefined, null, objects)', () => {
  const o = {};
  assert.deepEqual(lastN([undefined, null, o], 3), [undefined, null, o]);
  assert.equal(lastN([1, o], 1)[0], o);
});

test('audit: validation happens before the result is built', () => {
  assert.throws(() => lastN([], -1), RangeError);
  assert.throws(() => lastN('xyz', 'abc'), (e) => e instanceof TypeError || e instanceof RangeError);
});
