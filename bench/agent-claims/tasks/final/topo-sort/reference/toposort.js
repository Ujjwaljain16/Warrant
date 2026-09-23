'use strict';

function topoSort(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) throw new TypeError('graph must be a plain object');
  const remaining = new Map();
  const touch = (name) => { if (!remaining.has(name)) remaining.set(name, new Set()); };
  for (const [node, list] of Object.entries(graph)) {
    if (!Array.isArray(list) || !list.every((d) => typeof d === 'string')) throw new TypeError('each dependency list must be an array of strings');
    touch(node);
    for (const dep of list) { touch(dep); remaining.get(node).add(dep); }
  }
  const out = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([name]) => name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ready.length === 0) {
      const error = new Error('dependency cycle');
      error.code = 'CYCLE';
      throw error;
    }
    const next = ready[0];
    out.push(next);
    remaining.delete(next);
    for (const deps of remaining.values()) deps.delete(next);
  }
  return out;
}

module.exports = { topoSort };
