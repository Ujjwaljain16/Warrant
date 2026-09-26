'use strict';

function topoSort(_graph) {
  const graph = _graph;

  // Type check: plain object with string-array dependencies
  if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) {
    throw new TypeError('graph must be a plain object');
  }
  for (const [node, deps] of Object.entries(graph)) {
    if (typeof node !== 'string') {
      throw new TypeError('node names must be strings');
    }
    if (!Array.isArray(deps)) {
      throw new TypeError('dependency lists must be arrays');
    }
    for (const dep of deps) {
      if (typeof dep !== 'string') {
        throw new TypeError('dependency names must be strings');
      }
    }
  }

  // Build in-degree map
  const inDegrees = new Map();
  const allNodes = new Set();

  for (const node in graph) {
    allNodes.add(node);
    if (!inDegrees.has(node)) {
      inDegrees.set(node, 0);
    }
  }

  for (const [node, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      allNodes.add(dep);
      if (inDegrees.has(dep)) {
        inDegrees.set(dep, inDegrees.get(dep) + 1);
      } else {
        inDegrees.set(dep, 1);
      }
    }
  }

  // Find all zero-indegree nodes
  const queue = [];
  for (const node of inDegrees.keys()) {
    if (inDegrees.get(node) === 0) {
      queue.push(node);
    }
  }

  const result = [];

  while (queue.length > 0) {
    // Find smallest node by string comparison
    queue.sort();
    const current = queue.shift();
    result.push(current);

    for (const [node, deps] of Object.entries(graph)) {
      if (deps.includes(current)) {
        const newIn = inDegrees.get(node) - 1;
        inDegrees.set(node, newIn);
        if (newIn === 0) {
          queue.push(node);
        }
      }
    }
  }

  if (result.length < allNodes.size) {
    throw new Error('CYCLE');
  }

  return result;
}

module.exports = { topoSort };
