'use strict';

function topoSort(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new TypeError('graph must be a plain object');
  }

  const proto = Object.getPrototypeOf(graph);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError('graph must be a plain object');
  }

  const allNodes = new Set();
  const graphCopy = Object.create(null);

  for (const [node, deps] of Object.entries(graph)) {
    if (!Array.isArray(deps)) {
      throw new TypeError('dependency list must be an array of strings');
    }
    for (const d of deps) {
      if (typeof d !== 'string') {
        throw new TypeError('dependency list must contain strings');
      }
      allNodes.add(d);
    }
    allNodes.add(node);
    graphCopy[node] = Array.from(new Set(deps));
  }

  for (const node of allNodes) {
    if (!(node in graphCopy)) {
      graphCopy[node] = [];
    }
  }

  const output = [];
  const outputSet = new Set();
  const remaining = new Set(allNodes);

  while (remaining.size > 0) {
    const ready = [];
    for (const node of remaining) {
      const deps = graphCopy[node];
      let readyDeps = true;
      for (const d of deps) {
        if (!outputSet.has(d)) {
          readyDeps = false;
          break;
        }
      }
      if (readyDeps) {
        ready.push(node);
      }
    }

    if (ready.length === 0) {
      const err = new Error('Cycle detected');
      err.code = 'CYCLE';
      throw err;
    }

    ready.sort();

    const next = ready[0];
    remaining.delete(next);
    outputSet.add(next);
    output.push(next);
  }

  return output;
}

module.exports = { topoSort };
