'use strict';

const crypto = require('node:crypto');

function sha(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// Minimal valid task; every test builds on this so field requirements live in one place.
function task(id, overrides = {}) {
  const out = overrides.outputs || ['out'];
  return {
    id,
    deps: [],
    effect: 'pure',
    deadline_ms: 1000,
    max_attempts: 3,
    outputs: out,
    requirements: [{ id: 'digest', kind: 'artifact_sha256', artifact: out[0], sha256: sha(`content:${id}`) }],
    ...overrides,
  };
}

function spec(tasks, overrides = {}) {
  return { spec_version: '1', run_id: 'run-test', max_concurrency: 4, tasks, ...overrides };
}

module.exports = { sha, spec, task };
