'use strict';

// Append-only, hash-chained run log.
//
// Derived from third_party/citadel/core/operations/journal.js (MIT, Seth Gammon). Kept from upstream:
// contiguous sequence numbers, `prev` hash chaining over canonical JSON, fail-closed validation of every
// entry on read. Changed (see UPSTREAM_PROVENANCE.md):
//   * arbitrary typed events (allow-listed) instead of the fixed idempotency-checkpoint schema;
//   * ONE writer lock held for the lifetime of the handle, with dead-owner reclamation, instead of a
//     pid file created and removed around every append that is never reclaimed after a crash;
//   * single JSONL file with a tolerated torn final line, instead of one file per entry;
//   * an in-memory implementation with identical chain semantics for simulation.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256Digest } = require('../../third_party/citadel/core/operations/canonical');
const { findForbiddenKey, isId, isPlainObject } = require('../core/ids');

const LOG_VERSION = 1;
const EVENT_TYPES = Object.freeze([
  'run_started', 'attempt_started', 'attempt_result', 'attempt_ambiguous', 'attempt_failed',
  'gate_verdict', 'reconcile', 'task_settled', 'duplicate_ignored', 'cancel_requested', 'run_finished',
]);
const MAX_DATA_BYTES = 8192;
const ENTRY_FIELDS = ['v', 'seq', 't', 'type', 'task', 'attempt', 'data', 'prev', 'hash'];
const DIGEST = /^sha256:[a-f0-9]{64}$/;

class LogCorruptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LogCorruptionError';
    this.code = code;
  }
}

class LogLockedError extends Error {
  constructor(owner) {
    super(`run log is locked by live process ${owner && owner.pid}`);
    this.name = 'LogLockedError';
    this.code = 'LOG_LOCKED';
    this.owner = owner;
  }
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

function validateEntry(entry, expectedSeq, expectedPrev, { verifyHash = true } = {}) {
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
  else if (Buffer.byteLength(JSON.stringify(entry.data)) > MAX_DATA_BYTES) errors.push('data exceeds the size limit');
  if (entry.prev !== expectedPrev) errors.push('hash chain is broken');
  if (entry.prev !== null && !DIGEST.test(entry.prev)) errors.push('prev must be null or a sha256 digest');
  if (typeof entry.hash !== 'string' || !DIGEST.test(entry.hash)) errors.push('hash must be a sha256 digest');
  else if (verifyHash && errors.length === 0 && entry.hash !== sha256Digest(entryBody(entry))) errors.push('hash does not match entry content');
  return errors;
}

function buildEntry(seq, prev, type, fields, t) {
  const entry = { v: LOG_VERSION, seq, t, type, data: fields.data || {}, prev };
  if (fields.task !== undefined) entry.task = fields.task;
  if (fields.attempt !== undefined) entry.attempt = fields.attempt;
  // The hash does not exist yet; validate everything else, then compute it exactly once.
  const errors = validateEntry({ ...entry, hash: `sha256:${'0'.repeat(64)}` }, seq, prev, { verifyHash: false });
  if (errors.length) throw new TypeError(`invalid log event: ${errors.join('; ')}`);
  return Object.freeze({ ...entry, hash: sha256Digest(entryBody(entry)) });
}

// Validates a full sequence of entries. Throws LogCorruptionError naming the first bad entry.
function verifyEntries(entries) {
  let prev = null;
  entries.forEach((entry, i) => {
    const errors = validateEntry(entry, i + 1, prev);
    if (errors.length) throw new LogCorruptionError('INVALID_ENTRY', `entry ${i + 1}: ${errors.join('; ')}`);
    prev = entry.hash;
  });
  return { count: entries.length, head: prev };
}

class MemoryRunLog {
  constructor() {
    this._entries = [];
    this._head = null;
  }

  append(type, fields = {}, t = 0) {
    const entry = buildEntry(this._entries.length + 1, this._head, type, fields, t);
    this._entries.push(entry);
    this._head = entry.hash;
    return entry;
  }

  entries() { return this._entries; }
  head() { return this._head; }
  close() {}
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function readOwner(lockPath) {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_error) { return null; }
}

// Holds exclusive writer ownership for the lifetime of the handle. A lock whose owner process is gone
// (or unreadable) is reclaimed. Limitation: pid reuse by an unrelated live process makes a stale lock look
// live; `breakLock: true` is the explicit override.
function acquireLock(lockPath, { breakLock = false } = {}) {
  const nonce = crypto.randomBytes(8).toString('hex');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, nonce }));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return { lockPath, nonce };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const owner = readOwner(lockPath);
    const live = owner && Number.isInteger(owner.pid) && isProcessAlive(owner.pid) && owner.pid !== process.pid;
    if (live && !breakLock) throw new LogLockedError(owner);
    const parked = `${lockPath}.reclaimed.${nonce}`;
    try { fs.renameSync(lockPath, parked); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const taken = readOwner(parked);
    if (owner && taken && taken.nonce !== owner.nonce) {
      // We parked a lock another process created after we inspected it. Put it back and report it as held.
      try { fs.renameSync(parked, lockPath); } catch (_error) { /* best effort */ }
      throw new LogLockedError(taken);
    }
    fs.rmSync(parked, { force: true });
  }
  throw new LogLockedError(readOwner(lockPath));
}

function parseLines(text, file) {
  const entries = [];
  let offset = 0;
  let torn = null;
  const lines = text.split('\n');
  const endsClean = text.endsWith('\n');
  lines.forEach((line, i) => {
    const isLast = i === lines.length - 1;
    if (isLast && line === '') return;
    let parsed;
    try { parsed = JSON.parse(line); } catch (_error) { parsed = undefined; }
    if (parsed === undefined || (isLast && !endsClean)) {
      if (isLast) { torn = { offset, bytes: Buffer.byteLength(line) }; return; }
      throw new LogCorruptionError('INVALID_JSON', `${file}: line ${i + 1} is not valid JSON`);
    }
    entries.push(parsed);
    offset += Buffer.byteLength(line) + 1;
  });
  return { entries, torn, goodBytes: offset };
}

// Read-only load for verification and inspection. Never modifies the file; reports a torn tail.
function readRunLogFile(file) {
  if (!fs.existsSync(file)) return { entries: [], head: null, torn: false };
  const { entries, torn } = parseLines(fs.readFileSync(file, 'utf8'), file);
  const { head } = verifyEntries(entries);
  return { entries, head, torn: Boolean(torn) };
}

class FileRunLog {
  constructor(file, { breakLock = false, durable = true } = {}) {
    this.file = file;
    this.durable = durable;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this._lock = acquireLock(`${file}.lock`, { breakLock });
    try {
      this.repaired = false;
      let entries = [];
      if (fs.existsSync(file)) {
        const parsed = parseLines(fs.readFileSync(file, 'utf8'), file);
        entries = parsed.entries;
        verifyEntries(entries);
        if (parsed.torn) {
          fs.truncateSync(file, parsed.goodBytes);
          this.repaired = true;
        }
      }
      this._entries = entries;
      this._head = entries.length ? entries[entries.length - 1].hash : null;
      this._fd = fs.openSync(file, 'a');
    } catch (error) {
      this._release();
      throw error;
    }
  }

  append(type, fields = {}, t = 0) {
    if (this._fd === undefined) throw new Error('run log is closed');
    const entry = buildEntry(this._entries.length + 1, this._head, type, fields, t);
    fs.writeSync(this._fd, `${JSON.stringify(entry)}\n`);
    if (this.durable) fs.fsyncSync(this._fd);
    this._entries.push(entry);
    this._head = entry.hash;
    return entry;
  }

  entries() { return this._entries; }
  head() { return this._head; }

  _release() {
    if (this._lock) {
      const owner = readOwner(this._lock.lockPath);
      if (owner && owner.nonce === this._lock.nonce) fs.rmSync(this._lock.lockPath, { force: true });
      this._lock = null;
    }
  }

  close() {
    if (this._fd !== undefined) { fs.closeSync(this._fd); this._fd = undefined; }
    this._release();
  }
}

module.exports = Object.freeze({
  EVENT_TYPES, FileRunLog, LOG_VERSION, LogCorruptionError, LogLockedError, MemoryRunLog,
  acquireLock, buildEntry, readRunLogFile, validateEntry, verifyEntries,
});
