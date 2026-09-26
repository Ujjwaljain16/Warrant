'use strict';

function topoSort(graph) {
  // Validate input
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new TypeError();
  }

  // Collect all nodes
  const nodes = new Set(Object.keys(graph));
  for (const deps of Object.values(graph)) {
    if (!Array.isArray(deps)) {
      throw new TypeError();
    }
    for (const dep of deps) {
      if (typeof dep !== 'string') {
        throw new TypeError();
      }
      nodes.add(dep);
    }
  }

  // Build dependency map for all nodes
  const deps = new Map();
  for (const node of nodes) {
    deps.set(node, new Set(graph[node] || []));
  }

  // Track visited and in-progress nodes for cycle detection
  const visited = new Set();
  const inProgress = new Set();
  const result = [];

  // DFS to detect cycles
  function hasCycle(node) {
    if (inProgress.has(node)) {
      return true; // Cycle detected
    }
    if (visited.has(node)) {
      return false; // Already processed
    }

    inProgress.add(node);
    for (const dep of deps.get(node)) {
      if (hasCycle(dep)) {
        return true;
      }
    }
    inProgress.delete(node);
    visited.add(node);
    return false;
  }

  // Check for cycles
  for (const node of nodes) {
    if (!visited.has(node)) {
      if (hasCycle(node)) {
        const error = new Error();
        error.code = 'CYCLE';
        throw error;
      }
    }
  }

  // Build result using topological sort
  // Repeatedly find and output the smallest node whose dependencies are all output
  const output = new Set();
  const sortedNodes = Array.from(nodes).sort();

  while (output.size < nodes.size) {
    let found = false;
    for (const node of sortedNodes) {
      if (!output.has(node)) {
        // Check if all dependencies are already output
        let allDepsOutput = true;
        for (const dep of deps.get(node)) {
          if (!output.has(dep)) {
            allDepsOutput = false;
            break;
          }
        }
        if (allDepsOutput) {
          result.push(node);
          output.add(node);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      // Should not happen if cycle check passed
      const error = new Error();
      error.code = 'CYCLE';
      throw error;
    }
  }

  return result;
}

module.exports = { topoSort };
