'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lowerBound, upperBound } = require('./bounds');

test('audit: agrees with a linear scan on many arrays and targets', () => {
  const arrays = [[], [0], [1, 1], [1, 2], [-5, -5, 0, 0, 0, 3.5, 7, 7], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 2, 2, 2, 2, 2, 2]];
  for (const a of arrays) {
    for (let x = -7; x <= 12; x += 0.5) {
      const lo = a.findIndex((v) => v >= x);
      const hi = a.findIndex((v) => v > x);
      assert.equal(lowerBound(a, x), lo === -1 ? a.length : lo, `lowerBound ${JSON.stringify(a)} ${x}`);
      assert.equal(upperBound(a, x), hi === -1 ? a.length : hi, `upperBound ${JSON.stringify(a)} ${x}`);
    }
  }
});

test('audit: infinite targets', () => {
  assert.equal(lowerBound([1, 2, 3], Infinity), 3);
  assert.equal(upperBound([1, 2, 3], -Infinity), 0);
  assert.equal(lowerBound([1, 2, Infinity], Infinity), 2);
  assert.equal(upperBound([1, 2, Infinity], Infinity), 3);
});
