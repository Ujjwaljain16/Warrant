'use strict';

const { isArtifactName, isPlainObject } = require('../core/ids');

const MAX_ARTIFACT_BYTES = 1 << 20;
const MAX_ARTIFACTS = 32;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * Validate a worker-supplied result envelope. Worker output is untrusted data: only the typed fields
 * below are read, unknown fields are dropped, and nothing in it can influence policy.
 *
 * Returns { ok: true, claim, artifacts, retryable, errorCode } or { ok: false, code, ignore }.
 * `ignore: true` means the envelope is not for this attempt and must not affect state at all.
 */
function parseEnvelope(raw, expectedAttemptId) {
  if (!isPlainObject(raw)) return { ok: false, code: 'INVALID_ENVELOPE', ignore: false };
  if (raw.attemptId !== expectedAttemptId) return { ok: false, code: 'ATTEMPT_MISMATCH', ignore: true };
  if (raw.claim === 'failure') {
    return {
      ok: true, claim: 'failure', artifacts: null,
      retryable: raw.retryable !== false,
      errorCode: typeof raw.errorCode === 'string' && ERROR_CODE.test(raw.errorCode) ? raw.errorCode : 'WORKER_ERROR',
    };
  }
  if (raw.claim !== 'success') return { ok: false, code: 'INVALID_ENVELOPE', ignore: false };
  if (!isPlainObject(raw.artifacts)) return { ok: false, code: 'INVALID_ENVELOPE', ignore: false };
  const names = Object.keys(raw.artifacts);
  if (names.length > MAX_ARTIFACTS) return { ok: false, code: 'TOO_MANY_ARTIFACTS', ignore: false };
  const artifacts = Object.create(null);
  for (const name of names) {
    const body = raw.artifacts[name];
    if (!isArtifactName(name)) return { ok: false, code: 'INVALID_ARTIFACT_NAME', ignore: false };
    if (typeof body !== 'string') return { ok: false, code: 'INVALID_ARTIFACT_BODY', ignore: false };
    if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) return { ok: false, code: 'ARTIFACT_TOO_LARGE', ignore: false };
    artifacts[name] = body;
  }
  return { ok: true, claim: 'success', artifacts, retryable: true, errorCode: null };
}

// Keep only the artifacts the task declared as outputs; anything else the worker emitted is discarded.
function declaredArtifacts(task, artifacts) {
  const kept = Object.create(null);
  for (const name of task.outputs) if (Object.hasOwn(artifacts, name)) kept[name] = artifacts[name];
  return kept;
}

module.exports = Object.freeze({ MAX_ARTIFACTS, MAX_ARTIFACT_BYTES, declaredArtifacts, parseEnvelope });
