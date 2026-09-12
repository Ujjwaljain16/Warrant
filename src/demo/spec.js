'use strict';

const { assertRunSpec } = require('../core/spec');

// Everything below is decided by the host. buildSpec takes the SET of subtask ids and nothing else from a plan, so no
// planner (or worker) text can reach a command, a requirement, an effect class, a dependency, a deadline or a budget.
const HOST_POLICY = Object.freeze({
  maxConcurrency: 5, // every worker at once; the demo is about parallel agents
  workerDeadlineMs: 1_800_000, // generous: a live model is rate limited, and ordered delivery can make a finished worker wait for its elders
  integrateDeadlineMs: 300_000,
  workerMaxAttempts: 2, // a rejected fix gets one more try
  integrateMaxAttempts: 1,
  gateTimeoutMs: 150_000,
  loopMaxSteps: 12, // model calls per agent episode
});

// The command every gate runs. `gate.js` is a launcher the host writes into each attempt directory before the attempt
// starts (see worker.js): it names the hidden-test task directory, so the spec itself carries no machine-specific path.
const GATE_ARGV = Object.freeze(['node', 'gate.js']);

/**
 * mode 'gated':   one task per planned bug whose only requirement is that bug's hidden suite, plus `integrate`, which
 *                 depends on every worker and whose requirement is the hidden integration suite.
 * mode 'ungated': the ablation. The same worker tasks, but each is accepted on the worker's claim alone
 *                 (trust_worker: true, no requirements) and there is no integrate task.
 * Tasks are emitted in catalogue order, whatever order the planner listed them in.
 */
function buildSpec({ runId, catalogue, subtaskIds, mode, policy = HOST_POLICY }) {
  if (mode !== 'gated' && mode !== 'ungated') throw new TypeError('mode must be gated or ungated');
  if (!Array.isArray(subtaskIds) || !subtaskIds.every((id) => typeof id === 'string')) throw new TypeError('subtaskIds must be an array of ids');
  const wanted = new Set(subtaskIds);
  const bugs = catalogue.bugs.filter((b) => wanted.has(b.id));
  if (bugs.length !== wanted.size) throw new Error('subtaskIds names a bug that is not in the catalogue');
  if (bugs.length === 0) throw new Error('nothing to schedule');

  const tasks = bugs.map((bug) => {
    const task = {
      id: bug.id, deps: [], effect: 'pure', deadline_ms: policy.workerDeadlineMs, max_attempts: policy.workerMaxAttempts,
      outputs: [...bug.meta.outputs], requirements: [],
    };
    if (mode === 'gated') task.requirements = [{ id: 'hidden-tests', kind: 'command', argv: [...GATE_ARGV], timeout_ms: policy.gateTimeoutMs }];
    else task.trust_worker = true;
    return task;
  });
  if (mode === 'gated') {
    tasks.push({
      id: catalogue.integrate.id, deps: bugs.map((b) => b.id), effect: 'pure', deadline_ms: policy.integrateDeadlineMs,
      max_attempts: policy.integrateMaxAttempts, outputs: [...catalogue.integrate.meta.outputs],
      requirements: [{ id: 'integration-suite', kind: 'command', argv: [...GATE_ARGV], timeout_ms: policy.gateTimeoutMs }],
    });
  }
  return assertRunSpec({ spec_version: '1', run_id: runId, max_concurrency: policy.maxConcurrency, tasks });
}

module.exports = Object.freeze({ GATE_ARGV, HOST_POLICY, buildSpec });
