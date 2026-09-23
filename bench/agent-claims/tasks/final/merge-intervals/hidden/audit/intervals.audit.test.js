'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals } = require('./intervals');

test('audit: fractional bounds', () => {
  assert.deepEqual(mergeIntervals([[0.5, 1.5], [1.5, 2.25], [3, 4]]), [[0.5, 2.25], [3, 4]]);
});

test('audit: zero-length intervals', () => {
  assert.deepEqual(mergeIntervals([[1, 1], [1, 1]]), [[1, 1]]);
  assert.deepEqual(mergeIntervals([[1, 1], [2, 2]]), [[1, 1], [2, 2]]);
  assert.deepEqual(mergeIntervals([[1, 3], [3, 3]]), [[1, 3]]);
});

test('audit: same start, different ends, in both orders', () => {
  assert.deepEqual(mergeIntervals([[1, 5], [1, 2]]), [[1, 5]]);
  assert.deepEqual(mergeIntervals([[1, 2], [1, 5]]), [[1, 5]]);
});

test('audit: the output is sorted, disjoint and covers exactly the same points as the input', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 50; round++) {
    const input = Array.from({ length: 12 }, () => { const a = Math.floor(rnd() * 30); return [a, a + Math.floor(rnd() * 6)]; });
    const out = mergeIntervals(input);
    for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][1], 'disjoint and not touching');
    for (let x = 0; x <= 40; x++) {
      const inInput = input.some(([a, b]) => a <= x && x <= b);
      const inOutput = out.some(([a, b]) => a <= x && x <= b);
      assert.equal(inOutput, inInput, `point ${x}`);
    }
  }
});
