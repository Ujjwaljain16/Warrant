'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spiral } = require('./spiral');

test('audit: every size up to 6 x 6 visits each cell once, starting top-left, each step adjacent', () => {
  for (let rows = 1; rows <= 6; rows++) {
    for (let cols = 1; cols <= 6; cols++) {
      const m = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * 10 + c));
      const out = spiral(m);
      assert.equal(out.length, rows * cols, `${rows}x${cols}`);
      assert.equal(new Set(out).size, rows * cols);
      assert.equal(out[0], 0);
      for (let i = 1; i < out.length; i++) {
        const [r1, c1] = [Math.floor(out[i - 1] / 10), out[i - 1] % 10];
        const [r2, c2] = [Math.floor(out[i] / 10), out[i] % 10];
        assert.equal(Math.abs(r1 - r2) + Math.abs(c1 - c2), 1, `${rows}x${cols} step ${i}`);
      }
    }
  }
});

test('audit: a 5 x 1 column, a 1 x 5 row, a 3 x 5 and a 5 x 3 matrix', () => {
  assert.deepEqual(spiral([[1], [2], [3], [4], [5]]), [1, 2, 3, 4, 5]);
  assert.deepEqual(spiral([[1, 2, 3, 4, 5]]), [1, 2, 3, 4, 5]);
  assert.deepEqual(spiral([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]), [1, 2, 3, 4, 5, 10, 15, 14, 13, 12, 11, 6, 7, 8, 9]);
  assert.deepEqual(spiral([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]]), [1, 2, 3, 6, 9, 12, 15, 14, 13, 10, 7, 4, 5, 8, 11]);
});

test('audit: elements of any type are returned as they are', () => {
  const o = {};
  assert.deepEqual(spiral([['a', o], [null, undefined]]), ['a', o, undefined, null]);
});
