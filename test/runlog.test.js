'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  FileRunLog, LogCorruptionError, LogLockedError, MemoryRunLog, readRunLogFile, verifyEntries,
} = require('../src/log/runlog');
const upstream = require('../third_party/citadel/core/operations');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `warrant-${prefix}-`));
}

function fill(log, n = 3) {
  for (let i = 1; i <= n; i++) log.append('attempt_started', { task: 'a', attempt: `a.${i}`, data: { n: i } }, i * 10);
}

test('memory log: sequence is contiguous and each entry chains to the previous hash', () => {
  const log = new MemoryRunLog();
  fill(log, 4);
  const entries = log.entries();
  assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3, 4]);
  assert.equal(entries[0].prev, null);
  for (let i = 1; i < entries.length; i++) assert.equal(entries[i].prev, entries[i - 1].hash);
  assert.deepEqual(verifyEntries(entries), { count: 4, head: log.head() });
});

test('memory log: events are validated at the boundary', () => {
  const log = new MemoryRunLog();
  assert.throws(() => log.append('not_an_event', {}), /unknown event type/);
  assert.throws(() => log.append('attempt_started', { task: 'Bad Id' }), /task must be an identifier/);
  assert.throws(() => log.append('attempt_started', { data: { fn() {} } }), /small plain JSON object/);
  assert.throws(() => log.append('attempt_started', { data: JSON.parse('{"__proto__":{"x":1}}') }), /forbidden key/);
  assert.throws(() => log.append('attempt_started', { data: { big: 'x'.repeat(9000) } }), /size limit/);
  assert.equal(log.entries().length, 0, 'rejected events must leave no trace');
});

test('verifyEntries: every kind of tampering is detected', () => {
  const log = new MemoryRunLog();
  fill(log, 4);
  const clone = () => JSON.parse(JSON.stringify(log.entries()));
  const edited = clone(); edited[1].data.n = 999;
  assert.throws(() => verifyEntries(edited), (e) => e instanceof LogCorruptionError && /entry 2: .*hash does not match/.test(e.message));
  const removed = clone(); removed.splice(1, 1);
  assert.throws(() => verifyEntries(removed), /entry 2: .*sequence 3 is not the expected 2/);
  const reordered = clone(); [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  assert.throws(() => verifyEntries(reordered), LogCorruptionError);
  const rehashed = clone(); rehashed[2].prev = rehashed[0].hash;
  assert.throws(() => verifyEntries(rehashed), /hash chain is broken/);
  const extra = clone(); extra[0].admin = true;
  assert.throws(() => verifyEntries(extra), /unknown field "admin"/);
});

test('file log: survives close and reopen with the chain intact', () => {
  const dir = tmp('log');
  const file = path.join(dir, 'run.log');
  const a = new FileRunLog(file);
  fill(a, 3);
  const head = a.head();
  a.close();
  const b = new FileRunLog(file);
  assert.equal(b.head(), head);
  assert.equal(b.entries().length, 3);
  b.append('run_finished', { data: { status: 'succeeded' } }, 99);
  b.close();
  assert.equal(readRunLogFile(file).entries.length, 4);
  assert.equal(fs.existsSync(`${file}.lock`), false, 'lock released on close');
});

test('file log: a torn final line (crash mid-append) is truncated on open and nothing else is lost', () => {
  const dir = tmp('torn');
  const file = path.join(dir, 'run.log');
  const a = new FileRunLog(file);
  fill(a, 3);
  a.close();
  const good = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, '{"v":1,"seq":4,"t":40,"type":"attempt_sta');
  assert.equal(readRunLogFile(file).torn, true, 'read-only inspection reports the torn tail without modifying it');
  assert.ok(fs.readFileSync(file, 'utf8').length > good.length);
  const b = new FileRunLog(file);
  assert.equal(b.repaired, true);
  assert.equal(b.entries().length, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), good, 'file is restored to the last complete entry');
  b.close();
});

test('file log: corruption anywhere but the final line fails closed', () => {
  const dir = tmp('corrupt');
  const file = path.join(dir, 'run.log');
  const a = new FileRunLog(file);
  fill(a, 4);
  a.close();
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[1] = lines[1].replace('"n":2', '"n":7');
  fs.writeFileSync(file, lines.join('\n'));
  assert.throws(() => new FileRunLog(file), (e) => e instanceof LogCorruptionError && /entry 2/.test(e.message));
  assert.equal(fs.existsSync(`${file}.lock`), false, 'a failed open must not leave the lock behind');
  lines[1] = '{garbage';
  fs.writeFileSync(file, lines.join('\n'));
  assert.throws(() => new FileRunLog(file), (e) => e instanceof LogCorruptionError && e.code === 'INVALID_JSON');
});

test('file log: a second live writer is refused', () => {
  const dir = tmp('two-writers');
  const file = path.join(dir, 'run.log');
  const a = new FileRunLog(file);
  // Simulate another live process owning the lock by naming the parent process as owner.
  a.close();
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.ppid, nonce: 'other' }));
  assert.throws(() => new FileRunLog(file), (e) => e instanceof LogLockedError && e.owner.pid === process.ppid);
  const forced = new FileRunLog(file, { breakLock: true });
  forced.append('run_started', { data: {} }, 1);
  forced.close();
});

test('REGRESSION: a writer that dies holding the lock no longer wedges the log (upstream defect F2 in docs/AUDIT.md)', () => {
  const dir = tmp('stale-lock');
  const file = path.join(dir, 'run.log');
  const child = spawnSync(process.execPath, ['-e', `
    const { FileRunLog } = require(${JSON.stringify(path.resolve(__dirname, '../src/log/runlog'))});
    const log = new FileRunLog(${JSON.stringify(file)});
    log.append('run_started', { data: {} }, 1);
    process.exit(0); // dies without close(): lock file is left behind
  `]);
  assert.equal(child.status, 0, child.stderr.toString());
  assert.equal(fs.existsSync(`${file}.lock`), true, 'precondition: the crashed writer left its lock');
  const log = new FileRunLog(file);
  assert.equal(log.entries().length, 1, 'prior history is intact');
  log.append('attempt_started', { task: 'a', attempt: 'a.1', data: {} }, 2);
  assert.equal(log.entries().length, 2);
  log.close();
});

test('REGRESSION (documents the upstream defect): the vendored upstream journal stays wedged after the same crash', () => {
  const dir = tmp('upstream-wedge');
  const input = {
    run_id: 'run-a', attempt_id: 'attempt-a', idempotency_key: 'key-a', effect_class: 'pure',
    state: 'pending', payload_digest: upstream.sha256Digest({ x: 1 }), evidence_digest: null,
  };
  upstream.appendJournalEntry(dir, input);
  fs.writeFileSync(path.join(dir, '.append.lock'), '999999\n'); // owner 999999 crashed holding the lock
  for (let i = 0; i < 2; i++) {
    assert.throws(() => upstream.appendJournalEntry(dir, { ...input, idempotency_key: 'key-b' }), /already locked/);
  }
});

test('memory and file logs produce identical chains for identical events', () => {
  const mem = new MemoryRunLog();
  const file = new FileRunLog(path.join(tmp('parity'), 'run.log'));
  fill(mem, 5);
  fill(file, 5);
  assert.deepEqual(mem.entries().map((e) => e.hash), file.entries().map((e) => e.hash));
  file.close();
});
