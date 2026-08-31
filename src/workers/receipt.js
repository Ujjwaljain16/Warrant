'use strict';

// The receipt protocol: files in a per-attempt directory that let a later process decide, from evidence alone,
// whether a command's external effect was applied. Used by ReceiptWorker (the host side) and, optionally, by the
// commands themselves (the markIntent / writeReceipt helpers below; any language can write the same files).
//
// Files, all in the attempt directory:
//   attempt.json   written by the host: run, task, attempt, idempotency key, the child's pid, its exit code
//   effect.intent  written by the COMMAND, atomically, BEFORE it performs its external effect
//   receipt.json   written by the COMMAND, atomically, AFTER the effect and after every declared output file
//                  {"version":1,"idempotency_key":"<key>","outputs":{"<name>":"<sha256 hex of the file's bytes>"}}

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isPlainObject } = require('../core/ids');

const RECEIPT_VERSION = 1;
const FILES = Object.freeze({ attempt: 'attempt.json', intent: 'effect.intent', receipt: 'receipt.json' });
const MAX_RECORD_BYTES = 65_536;
const HEX64 = /^[a-f0-9]{64}$/;

class ReceiptError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ReceiptError';
    this.code = code;
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Write-then-rename in the same directory, with the data flushed before the rename: a reader sees the old file, the
// new file, or no file, never a prefix. The containing directory is not fsynced, so this survives a process crash;
// it is not claimed to survive power loss.
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// Reads a small JSON record. Returns null when the file does not exist; anything else wrong with it throws.
function readRecord(file) {
  let text;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new ReceiptError('RECORD_NOT_A_FILE', path.basename(file));
    if (stat.size > MAX_RECORD_BYTES) throw new ReceiptError('RECORD_TOO_LARGE', path.basename(file));
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof ReceiptError) throw error;
    throw new ReceiptError('RECORD_UNREADABLE', `${path.basename(file)}: ${error.code || error.message}`);
  }
  try {
    const value = JSON.parse(text);
    if (!isPlainObject(value)) throw new Error('not an object');
    return value;
  } catch (_error) {
    throw new ReceiptError('RECORD_INVALID', `${path.basename(file)} is not a JSON object`);
  }
}

/**
 * Check a receipt against the declared outputs. Returns { artifacts } when it is complete and consistent, null when no
 * receipt exists, and throws a ReceiptError when one exists but cannot be trusted. `readOutput(dir, name)` must return
 * the file's text or null if it is missing or unsafe (symlink, not a regular file, oversized).
 */
function verifyReceipt({ dir, idempotencyKey, outputs, readOutput }) {
  const receipt = readRecord(path.join(dir, FILES.receipt));
  if (receipt === null) return null;
  if (receipt.version !== RECEIPT_VERSION) throw new ReceiptError('RECEIPT_VERSION', 'unsupported receipt version');
  if (receipt.idempotency_key !== idempotencyKey) throw new ReceiptError('RECEIPT_KEY_MISMATCH', 'receipt belongs to a different task or run');
  if (!isPlainObject(receipt.outputs)) throw new ReceiptError('RECEIPT_INVALID', 'receipt.outputs must be an object');
  const artifacts = {};
  for (const name of outputs) {
    const claimed = Object.hasOwn(receipt.outputs, name) ? receipt.outputs[name] : undefined;
    if (typeof claimed !== 'string' || !HEX64.test(claimed)) throw new ReceiptError('RECEIPT_INVALID', `receipt has no valid digest for output "${name}"`);
    const body = readOutput(dir, name);
    if (body === null) throw new ReceiptError('OUTPUT_MISSING', `output "${name}" is missing or not a plain file`);
    if (sha256Hex(body) !== claimed) throw new ReceiptError('OUTPUT_DIGEST_MISMATCH', `output "${name}" does not match the receipt`);
    artifacts[name] = body;
  }
  return { artifacts };
}

// ----------------------------------------------------------------------------- helpers for commands (node)

// Call immediately before the external effect. Directory defaults to the attempt directory the host gave the command.
function markIntent({ dir = process.env.WARRANT_ATTEMPT_DIR } = {}) {
  if (!dir) throw new Error('markIntent: no attempt directory (WARRANT_ATTEMPT_DIR is not set)');
  writeFileAtomic(path.join(dir, FILES.intent), `${JSON.stringify({ version: RECEIPT_VERSION })}\n`);
}

// Call after the effect, once every declared output file has been written and closed.
function writeReceipt({ outputs, dir = process.env.WARRANT_ATTEMPT_DIR, idempotencyKey = process.env.WARRANT_IDEMPOTENCY_KEY }) {
  if (!dir || !idempotencyKey) throw new Error('writeReceipt: no attempt directory or idempotency key (WARRANT_* variables are not set)');
  const digests = {};
  for (const name of outputs) digests[name] = sha256Hex(fs.readFileSync(path.join(dir, name)));
  writeFileAtomic(path.join(dir, FILES.receipt), `${JSON.stringify({ version: RECEIPT_VERSION, idempotency_key: idempotencyKey, outputs: digests })}\n`);
}

module.exports = Object.freeze({ FILES, ReceiptError, markIntent, readRecord, sha256Hex, verifyReceipt, writeFileAtomic, writeReceipt });
