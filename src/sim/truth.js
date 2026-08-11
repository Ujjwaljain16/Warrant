'use strict';

const { digestArtifacts } = require('../core/gate');
const { hash32 } = require('./rng');

// Ground truth for simulated work. The correct output of a task is a pure function of its id and the
// digests of its dependencies' outputs, so a corrupted upstream result changes every downstream result
// and corruption can be traced through the DAG.

function correctContent(taskId, inputs) {
  const ordered = {};
  for (const dep of Object.keys(inputs).sort()) ordered[dep] = inputs[dep];
  return JSON.stringify({ inputs: ordered, n: hash32(taskId) % 1000, task: taskId });
}

function wrongContent(taskId, inputs, attemptNo) {
  // Well-formed JSON with the right shape and the wrong content: only a content check can catch it.
  const ordered = {};
  for (const dep of Object.keys(inputs).sort()) ordered[dep] = inputs[dep];
  return JSON.stringify({ inputs: ordered, n: -1 - attemptNo, task: taskId, wrong: true });
}

function artifactsDigestOf(content) {
  return digestArtifacts({ out: content });
}

// Expected artifacts digest per task, computed topologically from the workload alone.
function expectedDigests(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const task = byId.get(id);
    const inputs = {};
    for (const dep of task.deps) inputs[dep] = visit(dep);
    const content = correctContent(id, inputs);
    const digest = artifactsDigestOf(content);
    memo.set(id, digest);
    return digest;
  };
  for (const t of tasks) visit(t.id);
  return Object.fromEntries(memo);
}

module.exports = Object.freeze({ artifactsDigestOf, correctContent, expectedDigests, wrongContent });
