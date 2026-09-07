'use strict';

// Hash-chain verification: a port of validateEntry/verifyEntries from src/log/runlog.js, with the hash computed
// through WebCrypto. Error strings match the engine's so a broken log is described identically in both places.

const { canonicalSerialize, sha256HexOfText } = require('./canonical');
const { EVENT_TYPES } = require('./states');

const LOG_VERSION = 1;
const MAX_DATA_BYTES = 8192;
const ENTRY_FIELDS = ['v', 'seq', 't', 'type', 'task', 'attempt', 'data', 'prev', 'hash'];
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function isId(value) {
  return typeof value === 'string' && value.length <= 128 && ID_PATTERN.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findForbiddenKey(value, path = '$', depth = 0) {
  if (depth > 32) return `${path}(too deep)`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (FORBIDDEN_KEYS.includes(key)) return `${path}.${key}`;
      const hit = findForbiddenKey(value[key], `${path}.${key}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function plainJsonValue(value, depth = 0) {
  if (depth > 4) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((v) => plainJsonValue(v, depth + 1));
  if (isPlainObject(value)) return Object.keys(value).length <= 64 && Object.values(value).every((v) => plainJsonValue(v, depth + 1));
  return false;
}

function entryBody(entry) {
  const body = { v: entry.v, seq: entry.seq, t: entry.t, type: entry.type, data: entry.data, prev: entry.prev };
  if (entry.task !== undefined) body.task = entry.task;
  if (entry.attempt !== undefined) body.attempt = entry.attempt;
  return body;
}

// Everything validateEntry checks except the hash recomputation. Returns a list of error strings.
function structureErrors(entry, expectedSeq, expectedPrev) {
  const errors = [];
  if (!isPlainObject(entry)) return ['entry must be a plain object'];
  for (const key of Object.keys(entry)) if (!ENTRY_FIELDS.includes(key)) errors.push(`unknown field "${key}"`);
  if (entry.v !== LOG_VERSION) errors.push(`v must be ${LOG_VERSION}`);
  if (entry.seq !== expectedSeq) errors.push(`sequence ${entry.seq} is not the expected ${expectedSeq}`);
  if (!Number.isInteger(entry.t) || entry.t < 0) errors.push('t must be a non-negative integer');
  if (!EVENT_TYPES.includes(entry.type)) errors.push(`unknown event type "${entry.type}"`);
  if (entry.task !== undefined && !isId(entry.task)) errors.push('task must be an identifier');
  if (entry.attempt !== undefined && !isId(entry.attempt)) errors.push('attempt must be an identifier');
  if (!isPlainObject(entry.data) || !plainJsonValue(entry.data)) errors.push('data must be a small plain JSON object');
  else if (findForbiddenKey(entry.data)) errors.push('data contains a forbidden key');
  else if (new TextEncoder().encode(JSON.stringify(entry.data)).length > MAX_DATA_BYTES) errors.push('data exceeds the size limit');
  if (entry.prev !== expectedPrev) errors.push('hash chain is broken');
  if (entry.prev !== null && !DIGEST.test(entry.prev)) errors.push('prev must be null or a sha256 digest');
  if (typeof entry.hash !== 'string' || !DIGEST.test(entry.hash)) errors.push('hash must be a sha256 digest');
  return errors;
}

// Recompute the hash an entry should carry, or null if its fields cannot be canonicalised.
async function computeEntryHash(entry) {
  let serialized;
  try { serialized = canonicalSerialize(entryBody(entry)); } catch (_error) { return null; }
  return `sha256:${await sha256HexOfText(serialized)}`;
}

const BATCH = 512;

/**
 * Verify the parsed log (the result of parseLog).
 * status: 'empty' | 'valid' | 'broken'. `torn` is reported alongside: a torn final line is tolerated, as in the engine.
 * `verified` entries (a prefix) passed every check; `broken` names the first failure and why.
 */
async function verifyChain(parsed) {
  const { entries, lineNumbers, problems, torn } = parsed;
  const limit = problems.length ? problems[0].afterEntries : entries.length;
  let head = null;
  let verified = 0;
  let broken = null;
  for (let start = 0; start < limit && !broken; start += BATCH) {
    const end = Math.min(limit, start + BATCH);
    const checks = [];
    let prev = start === 0 ? null : entries[start - 1].hash;
    for (let i = start; i < end; i++) {
      const errors = structureErrors(entries[i], i + 1, prev);
      checks.push({ errors, expected: errors.length === 0 ? computeEntryHash(entries[i]) : null });
      prev = isPlainObject(entries[i]) ? entries[i].hash : null;
    }
    const expectedHashes = await Promise.all(checks.map((c) => c.expected));
    for (let k = 0; k < checks.length; k++) {
      const i = start + k;
      const errors = checks[k].errors.slice();
      const expected = expectedHashes[k];
      if (errors.length === 0 && expected !== entries[i].hash) errors.push('hash does not match entry content');
      if (errors.length) {
        const plain = isPlainObject(entries[i]);
        broken = {
          kind: 'entry', index: i + 1, line: lineNumbers[i], seq: plain ? entries[i].seq : null,
          errors, message: `entry ${i + 1}: ${errors.join('; ')}`,
          expectedHash: expected, storedHash: plain ? entries[i].hash : null,
        };
        break;
      }
      verified++;
      head = entries[i].hash;
    }
  }
  if (!broken && problems.length) {
    const p = problems[0];
    broken = { kind: p.kind, index: limit + 1, line: p.line, seq: null, errors: [p.message], message: p.message, expectedHash: null, storedHash: null };
  }
  const status = broken ? 'broken' : (entries.length === 0 ? 'empty' : 'valid');
  return { status, verified, head, broken, torn, total: entries.length };
}

module.exports = { computeEntryHash, entryBody, isId, isPlainObject, structureErrors, verifyChain };
