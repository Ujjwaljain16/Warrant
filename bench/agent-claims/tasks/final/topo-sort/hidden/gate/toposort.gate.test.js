'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topoSort } = require('./toposort');

test('smallest available node first', () => {
  assert.deepEqual(topoSort({ b: ['d'], a: ['d'], d: [], c: [] }), ['c', 'd', 'a', 'b']);
  assert.deepEqual(topoSort({ a: ['c'], b: [], c: [] }), ['b', 'c', 'a']);
});

test('names that only appear as dependencies are nodes', () => {
  assert.deepEqual(topoSort({ app: ['lib', 'util'], lib: ['util'] }), ['util', 'lib', 'app']);
  assert.deepEqual(topoSort({ x: ['a', 'b'] }), ['a', 'b', 'x']);
});

test('a diamond', () => {
  assert.deepEqual(topoSort({ top: ['left', 'right'], left: ['base'], right: ['base'], base: [] }), ['base', 'left', 'right', 'top']);
});

test('independent nodes are sorted', () => {
  assert.deepEqual(topoSort({ m: [], k: [], z: [], a: [] }), ['a', 'k', 'm', 'z']);
});

test('cycles throw an Error with code CYCLE', () => {
  for (const g of [{ a: ['b'], b: ['a'] }, { a: ['a'] }, { a: ['b'], b: ['c'], c: ['a'] }, { ok: [], a: ['b'], b: ['a'] }, { x: [], y: ['x', 'z'], z: ['y'] }]) {
    assert.throws(() => topoSort(g), (e) => e instanceof Error && e.code === 'CYCLE', JSON.stringify(g));
  }
});

test('duplicates in a list are harmless; the empty graph', () => {
  assert.deepEqual(topoSort({ a: ['b', 'b', 'b'], b: [] }), ['b', 'a']);
  assert.deepEqual(topoSort({}), []);
});

test('the graph is not modified', () => {
  const g = { b: ['a'], a: [] };
  topoSort(g);
  assert.deepEqual(g, { b: ['a'], a: [] });
});

test('argument checks', () => {
  for (const bad of [null, undefined, [], 'abc', 5]) assert.throws(() => topoSort(bad), TypeError);
  for (const bad of [{ a: 'b' }, { a: [1] }, { a: null }, { a: [null] }]) assert.throws(() => topoSort(bad), TypeError, JSON.stringify(bad));
});
