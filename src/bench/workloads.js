'use strict';

const { sha256Hex } = require('../core/verifiers');
const { assertRunSpec } = require('../core/spec');
const { unit } = require('../sim/rng');
const { correctContent, expectedDigests } = require('../sim/truth');

const DATASET_VERSION = 'workloads-v1';
const GENERATOR_SEED = 20261016;
const SHAPE_NAMES = Object.freeze(['chain-8', 'fanout-fanin-12', 'diamond-lattice-16', 'pipeline-24', 'random-dag-32']);

// Each generator returns [{ id, deps }] in a valid topological/declaration order.
const SHAPES = {
  'chain-8': () => Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, deps: i ? [`t${i - 1}`] : [] })),

  'fanout-fanin-12': () => {
    const mids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    return [{ id: 'root', deps: [] }, ...mids.map((id) => ({ id, deps: ['root'] })), { id: 'sink', deps: mids }];
  },

  'diamond-lattice-16': () => {
    const tasks = [];
    for (let layer = 0; layer < 4; layer++) {
      for (let i = 0; i < 4; i++) {
        tasks.push({ id: `l${layer}x${i}`, deps: layer ? [`l${layer - 1}x${i}`, `l${layer - 1}x${(i + 1) % 4}`] : [] });
      }
    }
    return tasks;
  },

  'pipeline-24': () => {
    const tasks = [];
    for (let stage = 0; stage < 6; stage++) {
      for (let lane = 0; lane < 4; lane++) tasks.push({ id: `s${stage}p${lane}`, deps: stage ? [`s${stage - 1}p${lane}`] : [] });
    }
    return tasks;
  },

  'random-dag-32': () => {
    const tasks = [];
    for (let i = 0; i < 32; i++) {
      const deps = [];
      for (let j = 0; j < i && deps.length < 3; j++) {
        if (unit(`${GENERATOR_SEED}|dag|${j}|${i}`) < 0.12) deps.push(`r${j}`);
      }
      if (i > 0 && deps.length === 0 && unit(`${GENERATOR_SEED}|dag-root|${i}`) < 0.85) deps.push(`r${Math.floor(unit(`${GENERATOR_SEED}|dag-pick|${i}`) * i)}`);
      tasks.push({ id: `r${i}`, deps });
    }
    return tasks;
  },
};

function effectFor(workloadId, taskId) {
  const u = unit(`${GENERATOR_SEED}|${workloadId}|${taskId}|effect`);
  if (u < 0.4) return 'pure';
  if (u < 0.6) return 'workspace-reversible';
  if (u < 0.8) return 'external-idempotent';
  return 'external-nonrepeatable';
}

function criticalPath(tasks) {
  const finish = new Map();
  for (const t of tasks) finish.set(t.id, t.nominal_ms + Math.max(0, ...t.deps.map((d) => finish.get(d))));
  return Math.max(...finish.values());
}

function descendantCount(tasks, id) {
  const children = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const d of t.deps) children.get(d).push(t.id);
  const seen = new Set();
  const stack = [...children.get(id)];
  while (stack.length) {
    const c = stack.pop();
    if (!seen.has(c)) { seen.add(c); stack.push(...children.get(c)); }
  }
  return seen.size;
}

// Compile hand-written or generated task drafts ({ id, deps, effect, nominal_ms }) into a validated spec
// whose requirements encode the ground truth.
function compileWorkload(id, draft, { requirements = 'full', maxConcurrency = 4 } = {}) {
  const expected = expectedDigests(draft);
  const tasks = draft.map((t) => {
    const inputs = {};
    for (const d of t.deps) inputs[d] = expected[d];
    const reqs = [];
    if (requirements === 'full' || requirements === 'digest-only') {
      reqs.push({ id: 'digest', kind: 'artifact_sha256', artifact: 'out', sha256: sha256Hex(correctContent(t.id, inputs)) });
    }
    if (requirements === 'shape-only' || (requirements === 'full' && unit(`${GENERATOR_SEED}|${id}|${t.id}|shape`) < 0.5)) {
      reqs.push({ id: 'shape', kind: 'artifact_json', artifact: 'out', shape: { inputs: 'object', n: 'number', task: 'string' } });
    }
    return {
      id: t.id, deps: t.deps, effect: t.effect, deadline_ms: t.nominal_ms * 3, max_attempts: 3,
      outputs: ['out'], requirements: reqs, nominal_ms: t.nominal_ms,
    };
  });
  const spec = assertRunSpec({ spec_version: '1', run_id: `run-${id}`, max_concurrency: maxConcurrency, tasks });
  const nonTrivial = spec.tasks.filter((t) => t.deps.length > 0);
  const failTask = nonTrivial.reduce((best, t) => (!best || descendantCount(spec.tasks, t.id) > descendantCount(spec.tasks, best) ? t.id : best), null);
  return Object.freeze({
    id,
    spec,
    expected,
    critical_path_ms: criticalPath(spec.tasks),
    fail_task: failTask,
    nonrepeatable: spec.tasks.filter((t) => t.effect === 'external-nonrepeatable').map((t) => t.id),
  });
}

function buildWorkload(id, options = {}) {
  const draft = SHAPES[id]().map((t) => ({
    id: t.id,
    deps: t.deps,
    effect: effectFor(id, t.id),
    nominal_ms: Math.round(100 * (0.8 + 0.4 * unit(`${GENERATOR_SEED}|${id}|${t.id}|latency`))),
  }));
  return compileWorkload(id, draft, options);
}

function allWorkloads(options) {
  return SHAPE_NAMES.map((id) => buildWorkload(id, options));
}

module.exports = Object.freeze({ DATASET_VERSION, GENERATOR_SEED, SHAPE_NAMES, allWorkloads, buildWorkload, compileWorkload });
