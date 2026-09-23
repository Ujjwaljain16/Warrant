'use strict';

function topoSort(graph) {
  const deps = new Map();
  for (const [node, list] of Object.entries(graph)) {
    if (!deps.has(node)) deps.set(node, new Set());
    for (const d of list) { if (!deps.has(d)) deps.set(d, new Set()); deps.get(node).add(d); }
  }
  const state = new Map();
  const out = [];
  const visit = (node) => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) { const e = new Error('dependency cycle'); e.code = 'CYCLE'; throw e; }
    state.set(node, 1);
    for (const d of [...deps.get(node)].sort()) visit(d);
    state.set(node, 2);
    out.push(node);
  };
  for (const node of [...deps.keys()].sort()) visit(node);
  return out;
}

module.exports = { topoSort };
