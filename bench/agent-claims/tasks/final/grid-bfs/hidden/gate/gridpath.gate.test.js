'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shortestPath } = require('./gridpath');

test('the shortest route, not just any route', () => {
  const grid = [
    '.....',
    '.###.',
    '.#...',
    '.#.##',
    '.....',
  ];
  assert.equal(shortestPath(grid, [0, 0], [2, 4]), 6);
  assert.equal(shortestPath(grid, [0, 0], [4, 4]), 8);
  assert.equal(shortestPath(grid, [2, 2], [0, 4]), 4);
});

test('rows and columns are not swapped', () => {
  assert.equal(shortestPath(['....', '....'], [0, 0], [1, 3]), 4);
  assert.equal(shortestPath(['..', '..', '..', '..'], [0, 0], [3, 1]), 4);
  assert.equal(shortestPath(['.#', '..', '#.', '..'], [0, 0], [3, 1]), 4);
});

test('same cell, walls at either end', () => {
  assert.equal(shortestPath(['...'], [0, 1], [0, 1]), 0);
  assert.equal(shortestPath(['.#.'], [0, 1], [0, 1]), -1);
  assert.equal(shortestPath(['.#.', '...'], [0, 1], [1, 2]), -1);
  assert.equal(shortestPath(['.#.', '...'], [0, 0], [0, 1]), -1);
});

test('moves are not diagonal', () => {
  assert.equal(shortestPath(['.#', '#.'], [0, 0], [1, 1]), -1);
});

test('unreachable cells inside walls', () => {
  assert.equal(shortestPath(['.....', '.###.', '.#.#.', '.###.', '.....'], [0, 0], [2, 2]), -1);
});

test('a one-cell grid', () => {
  assert.equal(shortestPath(['.'], [0, 0], [0, 0]), 0);
  assert.equal(shortestPath(['#'], [0, 0], [0, 0]), -1);
});

test('a 200 x 200 open grid is fast', () => {
  const grid = Array.from({ length: 200 }, () => '.'.repeat(200));
  const t0 = Date.now();
  assert.equal(shortestPath(grid, [0, 0], [199, 199]), 398);
  assert.ok(Date.now() - t0 < 3000);
});

test('a serpentine corridor', () => {
  const grid = ['.....', '####.', '.....', '.####', '.....'];
  assert.equal(shortestPath(grid, [0, 0], [4, 4]), 16);
});

test('bad positions are a RangeError', () => {
  const grid = ['..', '..'];
  for (const bad of [[2, 0], [0, 2], [-1, 0], [0, -1], [0.5, 0], [NaN, 0], [0], [0, 0, 0], 'ab', null, undefined]) {
    assert.throws(() => shortestPath(grid, bad, [0, 0]), RangeError, JSON.stringify(bad));
    assert.throws(() => shortestPath(grid, [0, 0], bad), RangeError, JSON.stringify(bad));
  }
});

test('bad grids are a TypeError', () => {
  for (const bad of [[], null, undefined, 'abc', ['..', '.'], [1, 2], [['.', '.']]]) assert.throws(() => shortestPath(bad, [0, 0], [0, 0]), TypeError);
});
