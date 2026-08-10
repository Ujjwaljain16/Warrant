'use strict';

const { sha256Digest } = require('../../third_party/citadel/core/operations/canonical');
const { checkRequirement, sha256Hex } = require('./verifiers');

// A GateVerdict is the only token that lets a task settle as `succeeded`. Verdicts are minted here and
// registered in a module-private WeakSet, so a plain object, a clone, or a spread copy is not a verdict.
const issued = new WeakSet();

function isGateVerdict(value) {
  return value !== null && typeof value === 'object' && issued.has(value);
}

function digestArtifacts(artifacts) {
  const hashes = {};
  for (const name of Object.keys(artifacts).sort()) hashes[name] = sha256Hex(artifacts[name]);
  return sha256Digest(hashes);
}

function freezeList(list) {
  return Object.freeze([...list]);
}

/**
 * Evaluate every requirement of a task against the artifacts of one attempt.
 *
 * status:
 *   'pass'          every requirement evaluated and held (or the task is explicitly claim-only)
 *   'fail'          at least one requirement was evaluated and did not hold
 *   'indeterminate' no requirement failed, but at least one could not be evaluated
 * `not_verified` always names the requirements that were not established, so an unknown outcome
 * says exactly what is unproven.
 */
async function evaluateGate({ task, attemptId, artifacts, ctx = {} }) {
  const results = [];
  const aborted = () => ctx.signal && ctx.signal.aborted;
  for (const req of task.requirements) {
    if (aborted()) {
      results.push({ id: req.id, status: 'error', code: 'GATE_ABORTED' });
      continue;
    }
    const outcome = await checkRequirement(req, { ...ctx, artifacts });
    const entry = { id: req.id, status: outcome.status, code: outcome.code };
    if (outcome.detail !== undefined) entry.detail = String(outcome.detail).slice(0, 200);
    results.push(entry);
  }
  const passed = results.filter((r) => r.status === 'pass').map((r) => r.id);
  const failed = results.filter((r) => r.status === 'fail').map((r) => r.id);
  const errored = results.filter((r) => r.status === 'error').map((r) => r.id);
  const status = failed.length ? 'fail' : errored.length ? 'indeterminate' : 'pass';
  const verdict = Object.freeze({
    task_id: task.id,
    attempt_id: attemptId,
    status,
    claim_only: task.requirements.length === 0,
    artifacts_digest: digestArtifacts(artifacts),
    passed: freezeList(passed),
    failed: freezeList(failed),
    not_verified: freezeList(errored),
    results: Object.freeze(results.map((r) => Object.freeze(r))),
  });
  issued.add(verdict);
  return verdict;
}

module.exports = Object.freeze({ digestArtifacts, evaluateGate, isGateVerdict });
