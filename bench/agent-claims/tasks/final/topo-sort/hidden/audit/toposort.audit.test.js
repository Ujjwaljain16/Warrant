'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { topoSort } = require('./toposort');

// Checks the specified order directly: each step must output the smallest node whose dependencies are all already out.
function isSpecifiedOrder(graph, order) {
  const names = new Set(Object.keys(graph));
  for (const list of Object.values(graph)) for (const d of list) names.add(d);
  if (order.length !== names.size || new Set(order).size !== names.size) return false;
  const done = new Set();
  for (const node of order) {
    const ready = [...names].filter((n) => !done.has(n) && (graph[n] || []).every((d) => done.has(d))).sort();
    if (ready[0] !== node) return false;
    done.add(node);
  }
  return true;
}

test('audit: random acyclic graphs give exactly the specified order', () => {
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (let round = 0; round < 40; round++) {
    const n = 3 + Math.floor(rnd() * 10);
    const names = Array.from({ length: n }, (_, i) => letters[i]);
    const rank = [...names].sort(() => rnd() - 0.5);
    const graph = {};
    for (const name of names) {
      graph[name] = rank.slice(0, rank.indexOf(name)).filter(() => rnd() < 0.3);
    }
    const order = topoSort(graph);
    assert.ok(isSpecifiedOrder(graph, order), JSON.stringify(graph) + ' -> ' + order.join(''));
  }
});

test('audit: a long chain and a wide fan-out', () => {
  const chain = {};
  for (let i = 1; i < 200; i++) chain[`n${String(i).padStart(3, '0')}`] = [`n${String(i - 1).padStart(3, '0')}`];
  chain.n000 = [];
  const order = topoSort(chain);
  assert.equal(order.length, 200);
  assert.equal(order[0], 'n000');
  assert.equal(order[199], 'n199');
  const fan = { root: [] };
  for (const c of 'zyxw') fan[c] = ['root'];
  assert.deepEqual(topoSort(fan), ['root', 'w', 'x', 'y', 'z']);
});

test('audit: ordering of names is by code unit, so digits and capitals come first', () => {
  assert.deepEqual(topoSort({ b: [], B: [], 1: [], a: [] }), ['1', 'B', 'a', 'b']);
});
