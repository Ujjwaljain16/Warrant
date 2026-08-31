'use strict';

const { EFFECT_CLASSES } = require('../../third_party/citadel/core/operations/journal');
const { sha256Digest } = require('../../third_party/citadel/core/operations/canonical');
const { SHA256_HEX, findForbiddenKey, isArtifactName, isId, isPlainObject } = require('./ids');

const SPEC_VERSION = '1';
const LIMITS = Object.freeze({
  maxTasks: 512, maxDeps: 64, maxRequirements: 32, maxOutputs: 16,
  maxAttempts: 10, maxConcurrency: 64, maxDeadlineMs: 86_400_000, maxArgv: 64, maxArgLength: 4096,
});
const REQUIREMENT_KINDS = Object.freeze(['artifact_sha256', 'artifact_json', 'command', 'predicate']);
const JSON_SHAPE_TYPES = Object.freeze(['string', 'number', 'boolean', 'array', 'object']);

const TOP_FIELDS = ['spec_version', 'run_id', 'max_concurrency', 'tasks'];
const TASK_FIELDS = ['id', 'deps', 'effect', 'deadline_ms', 'max_attempts', 'outputs', 'requirements', 'trust_worker', 'exec', 'nominal_ms'];
const REQUIREMENT_FIELDS = {
  artifact_sha256: ['id', 'kind', 'artifact', 'sha256'],
  artifact_json: ['id', 'kind', 'artifact', 'shape'],
  command: ['id', 'kind', 'argv', 'timeout_ms', 'expect_exit'],
  predicate: ['id', 'kind', 'name'],
};

class SpecError extends Error {
  constructor(errors) {
    super(`invalid run spec: ${errors.join('; ')}`);
    this.name = 'SpecError';
    this.code = 'INVALID_SPEC';
    this.errors = Object.freeze([...errors]);
  }
}

function exact(value, allowed, label, errors) {
  if (!isPlainObject(value)) { errors.push(`${label} must be a plain object`); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label}: unknown field "${key}"`);
  return true;
}

function intIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validArgv(argv) {
  return Array.isArray(argv) && argv.length >= 1 && argv.length <= LIMITS.maxArgv
    && argv.every((a) => typeof a === 'string' && a.length > 0 && a.length <= LIMITS.maxArgLength && !a.includes('\0'));
}

function validateRequirement(req, task, label, errors) {
  if (!isPlainObject(req)) { errors.push(`${label} must be a plain object`); return; }
  if (!REQUIREMENT_KINDS.includes(req.kind)) { errors.push(`${label}.kind must be one of ${REQUIREMENT_KINDS.join(', ')}`); return; }
  exact(req, REQUIREMENT_FIELDS[req.kind], label, errors);
  if (!isId(req.id)) errors.push(`${label}.id must be an identifier`);
  if (req.kind === 'artifact_sha256' || req.kind === 'artifact_json') {
    if (!isArtifactName(req.artifact)) errors.push(`${label}.artifact must be a valid artifact name`);
    else if (Array.isArray(task.outputs) && !task.outputs.includes(req.artifact)) errors.push(`${label}.artifact "${req.artifact}" is not a declared output of the task`);
  }
  if (req.kind === 'artifact_sha256' && !(typeof req.sha256 === 'string' && SHA256_HEX.test(req.sha256))) errors.push(`${label}.sha256 must be 64 lowercase hex characters`);
  if (req.kind === 'artifact_json') {
    if (!isPlainObject(req.shape) || Object.keys(req.shape).length === 0) errors.push(`${label}.shape must be a non-empty object`);
    else for (const [k, t] of Object.entries(req.shape)) if (!JSON_SHAPE_TYPES.includes(t)) errors.push(`${label}.shape.${k} must be one of ${JSON_SHAPE_TYPES.join(', ')}`);
  }
  if (req.kind === 'command') {
    if (!validArgv(req.argv)) errors.push(`${label}.argv must be a non-empty array of non-empty strings`);
    if (req.timeout_ms !== undefined && !intIn(req.timeout_ms, 1, 600_000)) errors.push(`${label}.timeout_ms must be an integer in 1..600000`);
    if (req.expect_exit !== undefined && !intIn(req.expect_exit, 0, 255)) errors.push(`${label}.expect_exit must be an integer in 0..255`);
  }
  if (req.kind === 'predicate' && !isId(req.name)) errors.push(`${label}.name must be an identifier`);
}

function validateTask(task, index, errors) {
  const label = `tasks[${index}]`;
  if (!exact(task, TASK_FIELDS, label, errors)) return;
  if (!isId(task.id)) errors.push(`${label}.id must be an identifier`);
  if (!Array.isArray(task.deps) || task.deps.length > LIMITS.maxDeps || !task.deps.every(isId)) errors.push(`${label}.deps must be an array of at most ${LIMITS.maxDeps} identifiers`);
  else if (new Set(task.deps).size !== task.deps.length) errors.push(`${label}.deps contains duplicates`);
  if (!EFFECT_CLASSES.includes(task.effect)) errors.push(`${label}.effect must be one of ${EFFECT_CLASSES.join(', ')}`);
  if (!intIn(task.deadline_ms, 1, LIMITS.maxDeadlineMs)) errors.push(`${label}.deadline_ms must be an integer in 1..${LIMITS.maxDeadlineMs}`);
  if (!intIn(task.max_attempts, 1, LIMITS.maxAttempts)) errors.push(`${label}.max_attempts must be an integer in 1..${LIMITS.maxAttempts}`);
  if (task.nominal_ms !== undefined && !intIn(task.nominal_ms, 1, LIMITS.maxDeadlineMs)) errors.push(`${label}.nominal_ms must be an integer in 1..${LIMITS.maxDeadlineMs}`);
  if (!Array.isArray(task.outputs) || task.outputs.length < 1 || task.outputs.length > LIMITS.maxOutputs
      || !task.outputs.every(isArtifactName) || new Set(task.outputs).size !== task.outputs.length) {
    errors.push(`${label}.outputs must be 1..${LIMITS.maxOutputs} unique valid artifact names`);
  }
  if (task.trust_worker !== undefined && typeof task.trust_worker !== 'boolean') errors.push(`${label}.trust_worker must be boolean`);
  if (!Array.isArray(task.requirements) || task.requirements.length > LIMITS.maxRequirements) {
    errors.push(`${label}.requirements must be an array of at most ${LIMITS.maxRequirements}`);
  } else {
    if (task.requirements.length === 0 && task.trust_worker !== true) {
      errors.push(`${label} has no requirements; set trust_worker:true to accept a claim-only task explicitly`);
    }
    if (task.requirements.length > 0 && task.trust_worker === true) errors.push(`${label}: trust_worker:true is only valid for a task with no requirements`);
    const seen = new Set();
    task.requirements.forEach((req, i) => {
      validateRequirement(req, task, `${label}.requirements[${i}]`, errors);
      if (isPlainObject(req) && typeof req.id === 'string') {
        if (seen.has(req.id)) errors.push(`${label}.requirements has duplicate id "${req.id}"`);
        seen.add(req.id);
      }
    });
  }
  if (task.exec !== undefined) {
    if (exact(task.exec, ['argv', 'receipt'], `${label}.exec`, errors)) {
      if (!validArgv(task.exec.argv)) errors.push(`${label}.exec.argv must be a non-empty array of non-empty strings`);
      if (task.exec.receipt !== undefined && typeof task.exec.receipt !== 'boolean') errors.push(`${label}.exec.receipt must be a boolean`);
    }
  }
}

// Kahn's algorithm; returns task ids in a deterministic topological order or null on a cycle.
function topologicalOrder(tasks) {
  const indegree = new Map(tasks.map((t) => [t.id, t.deps.length]));
  const children = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const d of t.deps) children.get(d).push(t.id);
  const order = [];
  const queue = tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const c of children.get(id)) {
      indegree.set(c, indegree.get(c) - 1);
      if (indegree.get(c) === 0) queue.push(c);
    }
  }
  return order.length === tasks.length ? order : null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// Specs produced by validateRunSpec are deep-frozen and therefore immutable, so re-validating one (or re-hashing it)
// can only repeat an answer that cannot have changed. Anything not minted here, including a clone or a mutated
// copy, is validated from scratch.
const validatedSpecs = new WeakSet();
const digests = new WeakMap();

function validateRunSpec(input) {
  if (input !== null && typeof input === 'object' && validatedSpecs.has(input)) return { ok: true, errors: [], spec: input };
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['spec must be a plain object'] };
  const forbidden = findForbiddenKey(input);
  if (forbidden) return { ok: false, errors: [`forbidden key at ${forbidden}`] };
  exact(input, TOP_FIELDS, 'spec', errors);
  if (input.spec_version !== SPEC_VERSION) errors.push(`spec_version must be "${SPEC_VERSION}"`);
  if (!isId(input.run_id)) errors.push('run_id must be an identifier');
  if (!intIn(input.max_concurrency, 1, LIMITS.maxConcurrency)) errors.push(`max_concurrency must be an integer in 1..${LIMITS.maxConcurrency}`);
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > LIMITS.maxTasks) {
    errors.push(`tasks must be an array of 1..${LIMITS.maxTasks} tasks`);
    return { ok: false, errors };
  }
  input.tasks.forEach((task, i) => validateTask(task, i, errors));
  if (errors.length === 0) {
    const ids = input.tasks.map((t) => t.id);
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) errors.push('task ids must be unique');
    for (const t of input.tasks) {
      for (const d of t.deps) {
        if (d === t.id) errors.push(`task ${t.id} depends on itself`);
        else if (!idSet.has(d)) errors.push(`task ${t.id} depends on unknown task ${d}`);
      }
    }
    if (errors.length === 0 && topologicalOrder(input.tasks) === null) errors.push('dependency graph contains a cycle');
  }
  if (errors.length) return { ok: false, errors };
  const spec = deepFreeze(JSON.parse(JSON.stringify(input)));
  validatedSpecs.add(spec);
  return { ok: true, errors: [], spec };
}

function assertRunSpec(input) {
  const result = validateRunSpec(input);
  if (!result.ok) throw new SpecError(result.errors);
  return result.spec;
}

function specDigest(spec) {
  if (!validatedSpecs.has(spec)) return sha256Digest(spec);
  if (!digests.has(spec)) digests.set(spec, sha256Digest(spec));
  return digests.get(spec);
}

module.exports = Object.freeze({
  LIMITS, REQUIREMENT_KINDS, SPEC_VERSION, SpecError,
  assertRunSpec, specDigest, topologicalOrder, validateRunSpec,
});
