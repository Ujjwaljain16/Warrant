'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shortestPath } = require('./gridpath');

test('an open grid', () => {
  assert.equal(shortestPath(['...', '...', '...'], [0, 0], [2, 2]), 4);
});

test('around a wall', () => {
  assert.equal(shortestPath(['..#', '.##', '...'], [0, 0], [2, 2]), 4);
});

test('no route', () => {
  assert.equal(shortestPath(['.#.', '.#.', '.#.'], [0, 0], [0, 2]), -1);
});
