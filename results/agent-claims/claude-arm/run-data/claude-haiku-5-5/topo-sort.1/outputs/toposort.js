'use strict';

function topoSort(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new TypeError('graph must be a plain object');
  }
  const proto = Object.getPrototypeOf(graph);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError('graph must be a plain object');
  }

  // Map each node to the set of distinct names it depends on.
  const remaining = new Map();
  for (const name of Object.keys(graph)) {
    const list = graph[name];
    if (!Array.isArray(list)) {
      throw new TypeError(`dependencies of "${name}" must be an array`);
    }
    const deps = new Set();
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] !== 'string') {
        throw new TypeError(`dependencies of "${name}" must be strings`);
      }
      deps.add(list[i]);
    }
    remaining.set(name, deps);
  }
  // Names that only appear inside a dependency list are nodes too.
  for (const deps of [...remaining.values()]) {
    for (const d of deps) {
      if (!remaining.has(d)) remaining.set(d, new Set());
    }
  }

  const done = new Set();
  const result = [];
  while (remaining.size > 0) {
    let best;
    for (const [node, deps] of remaining) {
      let ready = true;
      for (const d of deps) {
        if (!done.has(d)) {
          ready = false;
          break;
        }
      }
      if (ready && (best === undefined || node < best)) best = node;
    }
    if (best === undefined) {
      const err = new Error('dependency cycle detected');
      err.code = 'CYCLE';
      throw err;
    }
    result.push(best);
    done.add(best);
    remaining.delete(best);
  }
  return result;
}

module.exports = { topoSort };
