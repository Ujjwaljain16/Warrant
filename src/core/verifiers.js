'use strict';

const crypto = require('node:crypto');
const { runProcess } = require('../util/proc');
const { findForbiddenKey } = require('./ids');

// A verifier result is { status: 'pass' | 'fail' | 'error', code, detail? }.
//   pass  - the requirement was evaluated and holds
//   fail  - the requirement was evaluated and does not hold
//   error - the requirement could not be evaluated (verifier crashed, timed out, was unavailable).
// `error` is never treated as `pass`; the gate maps it to an indeterminate verdict.

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function hasArtifact(artifacts, name) {
  return Object.hasOwn(artifacts, name) && typeof artifacts[name] === 'string';
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

const CHECKS = {
  async artifact_sha256(req, ctx) {
    if (!hasArtifact(ctx.artifacts, req.artifact)) return { status: 'fail', code: 'MISSING_ARTIFACT' };
    return sha256Hex(ctx.artifacts[req.artifact]) === req.sha256
      ? { status: 'pass', code: 'DIGEST_MATCH' }
      : { status: 'fail', code: 'DIGEST_MISMATCH' };
  },

  async artifact_json(req, ctx) {
    if (!hasArtifact(ctx.artifacts, req.artifact)) return { status: 'fail', code: 'MISSING_ARTIFACT' };
    let parsed;
    try { parsed = JSON.parse(ctx.artifacts[req.artifact]); } catch (_error) { return { status: 'fail', code: 'INVALID_JSON' }; }
    if (findForbiddenKey(parsed)) return { status: 'fail', code: 'FORBIDDEN_KEY' };
    if (typeOf(parsed) !== 'object') return { status: 'fail', code: 'NOT_AN_OBJECT' };
    for (const [key, type] of Object.entries(req.shape)) {
      if (!Object.hasOwn(parsed, key)) return { status: 'fail', code: 'MISSING_FIELD', detail: key };
      if (typeOf(parsed[key]) !== type) return { status: 'fail', code: 'WRONG_TYPE', detail: key };
    }
    return { status: 'pass', code: 'SHAPE_OK' };
  },

  async command(req, ctx) {
    if (!ctx.workDir) return { status: 'error', code: 'NO_WORKDIR' };
    const result = await runProcess({
      argv: req.argv, cwd: ctx.workDir, timeoutMs: req.timeout_ms ?? 10_000, signal: ctx.signal,
    });
    if (result.spawnError) return { status: 'error', code: 'SPAWN_ERROR', detail: result.spawnError };
    if (result.timedOut) return { status: 'error', code: 'VERIFIER_TIMEOUT' };
    if (result.aborted) return { status: 'error', code: 'VERIFIER_ABORTED' };
    if (result.truncated) return { status: 'error', code: 'OUTPUT_LIMIT' };
    return result.exitCode === (req.expect_exit ?? 0)
      ? { status: 'pass', code: 'EXIT_OK' }
      : { status: 'fail', code: 'EXIT_MISMATCH', detail: String(result.exitCode) };
  },

  async predicate(req, ctx) {
    const fn = ctx.predicates && Object.hasOwn(ctx.predicates, req.name) ? ctx.predicates[req.name] : null;
    if (typeof fn !== 'function') return { status: 'error', code: 'UNKNOWN_PREDICATE', detail: req.name };
    try {
      const outcome = await fn(ctx.artifacts, ctx);
      if (outcome === true) return { status: 'pass', code: 'PREDICATE_TRUE' };
      if (outcome === false) return { status: 'fail', code: 'PREDICATE_FALSE' };
      return { status: 'error', code: 'PREDICATE_NON_BOOLEAN' };
    } catch (_error) {
      return { status: 'error', code: 'PREDICATE_THREW' };
    }
  },
};

async function checkRequirement(req, ctx) {
  const check = Object.hasOwn(CHECKS, req.kind) ? CHECKS[req.kind] : null;
  if (!check) return { status: 'error', code: 'UNKNOWN_KIND' };
  try {
    return await check(req, ctx);
  } catch (_error) {
    return { status: 'error', code: 'VERIFIER_CRASHED' };
  }
}

module.exports = Object.freeze({ checkRequirement, sha256Hex });
