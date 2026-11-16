'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildEntry, readRunLogFile, verifyEntries } = require('../src/log/runlog');
const { SigningError, generateKeyPair, loadPrivateKey, loadPublicKey, signHead, verifyHead } = require('../src/log/signing');
const { main } = require('../src/cli/main');

const EXAMPLE = path.resolve(__dirname, '..', 'examples', 'pipeline');
const SAMPLE = path.resolve(__dirname, '..', 'viewer', 'samples', 'lying-worker.jsonl');

function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `warrant-sign-${name}-`)); }
function cli(argv, cwd) {
  let out = '';
  let err = '';
  return main(argv, { cwd, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } }).then((code) => ({ code, out, err }));
}
const sampleEntries = () => fs.readFileSync(SAMPLE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const keys = () => crypto.generateKeyPairSync('ed25519');

// Rewrites one entry's data and recomputes every hash after it: a forgery the hash chain alone cannot detect.
function forge(entries, index, edit) {
  const out = [];
  let prev = null;
  entries.forEach((e, i) => {
    const data = i === index ? edit(structuredClone(e.data)) : e.data;
    const fields = { data };
    if (e.task !== undefined) fields.task = e.task;
    if (e.attempt !== undefined) fields.attempt = e.attempt;
    const rebuilt = buildEntry(e.seq, prev, e.type, fields, e.t);
    out.push(rebuilt);
    prev = rebuilt.hash;
  });
  return out;
}

test('signHead / verifyHead: a signed head verifies with its key and only with its key', () => {
  const entries = sampleEntries();
  const { privateKey, publicKey } = keys();
  const record = signHead(entries, privateKey, { now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(record.entries, entries.length);
  assert.equal(record.head, entries[entries.length - 1].hash);
  assert.equal(record.spec_digest, entries[0].data.spec_digest);
  assert.equal(verifyHead(entries, record, publicKey).valid, true);
  const other = keys().publicKey;
  const wrongKey = verifyHead(entries, record, other);
  assert.equal(wrongKey.valid, false);
  assert.match(wrongKey.reason, /not with the given key/);
});

test('verifyHead: a forged log whose chain still verifies is rejected by the signature', () => {
  const entries = sampleEntries();
  const { privateKey, publicKey } = keys();
  const record = signHead(entries, privateKey);
  // flip the first failed gate verdict to a pass and recompute every later hash, as the viewer's forged-success sample does
  const index = entries.findIndex((e) => e.type === 'gate_verdict' && e.data.status === 'fail');
  assert.ok(index > 0, 'the sample has a verdict to forge');
  const forged = forge(entries, index, (d) => ({ ...d, status: 'pass', passed: [...d.passed, ...d.failed], failed: [] }));
  assert.doesNotThrow(() => verifyEntries(forged), 'the forged chain is internally consistent');
  const result = verifyHead(forged, record, publicKey);
  assert.equal(result.valid, false);
  assert.match(result.reason, /rewritten/);
});

test('verifyHead: an edited record, a truncated log and an appended log are each reported', () => {
  const entries = sampleEntries();
  const { privateKey, publicKey } = keys();
  const record = signHead(entries, privateKey);
  for (const edit of [{ entries: record.entries - 1 }, { head: entries[2].hash }, { signed_at: '2000-01-01T00:00:00.000Z' }, { spec_digest: 'sha256:x' }]) {
    const r = verifyHead(entries, { ...record, ...edit }, publicKey);
    assert.equal(r.valid, false, JSON.stringify(edit));
  }
  const truncated = verifyHead(entries.slice(0, 5), record, publicKey);
  assert.equal(truncated.valid, false);
  assert.match(truncated.reason, /removed/);
  const shorter = signHead(entries.slice(0, 10), privateKey);
  const grown = verifyHead(entries, shorter, publicKey);
  assert.equal(grown.valid, true);
  assert.equal(grown.unsigned_entries, entries.length - 10);
  assert.equal(verifyHead(entries, { nope: 1 }, publicKey).valid, false);
  assert.equal(verifyHead(entries, { ...record, signature: 'AAAA' }, publicKey).valid, false);
  assert.throws(() => signHead([], privateKey), SigningError);
});

test('generateKeyPair: writes an owner-only private key, refuses to overwrite, and other key types are refused', () => {
  const dir = tmp('keys');
  const made = generateKeyPair(dir);
  assert.match(made.keyId, /^[0-9a-f]{16}$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(made.privateKeyFile).mode & 0o077, 0);
  assert.throws(() => generateKeyPair(dir), (e) => e.code === 'KEY_EXISTS');
  assert.equal(loadPrivateKey(made.privateKeyFile).asymmetricKeyType, 'ed25519');
  assert.equal(loadPublicKey(made.publicKeyFile).asymmetricKeyType, 'ed25519');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const rsaFile = path.join(dir, 'rsa.pem');
  fs.writeFileSync(rsaFile, rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => loadPrivateKey(rsaFile), (e) => e.code === 'BAD_KEY');
  assert.throws(() => loadPrivateKey(path.join(dir, 'missing.key')), (e) => e.code === 'BAD_KEY');
});

test('CLI: keygen, run --sign-key, verify-log --pubkey; a forged log and a foreign key both fail with exit 1', async () => {
  const cwd = tmp('cli');
  assert.equal((await cli(['keygen', '--out', 'keys'], cwd)).code, 0);
  const run = await cli(['run', path.join(EXAMPLE, 'spec.json'), '--dir', 'work', '--sign-key', 'keys/warrant-signing.key'], cwd);
  assert.equal(run.code, 0, run.err);
  assert.match(JSON.parse(run.out).signature.key_id, /^[0-9a-f]{16}$/);
  const logFile = path.join(cwd, 'work', 'run-pipeline', 'run.log');
  assert.ok(fs.existsSync(`${logFile}.sig`));

  const ok = await cli(['verify-log', logFile, '--spec', path.join(EXAMPLE, 'spec.json'), '--pubkey', 'keys/warrant-signing.pub'], cwd);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(JSON.parse(ok.out).signature.valid, true);

  // a second key pair: the signature is not this key's
  assert.equal((await cli(['keygen', '--out', 'other'], cwd)).code, 0);
  const foreign = await cli(['verify-log', logFile, '--pubkey', 'other/warrant-signing.pub'], cwd);
  assert.equal(foreign.code, 1);

  // forge the log (rewrite an entry, recompute every hash): the chain verifies, the signature does not
  const forged = forge(readRunLogFile(logFile).entries, 1, (d) => ({ ...d, forged: true }));
  fs.writeFileSync(logFile, `${forged.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const chainOnly = await cli(['verify-log', logFile], cwd);
  assert.equal(chainOnly.code, 0, 'without a key the forgery is invisible');
  const signed = await cli(['verify-log', logFile, '--pubkey', 'keys/warrant-signing.pub', '--format', 'text'], cwd);
  assert.equal(signed.code, 1);
  assert.match(signed.out, /signature .*rewritten/);

  // re-signing a log by hand works too
  const resigned = await cli(['sign-log', logFile, '--key', 'keys/warrant-signing.key', '--sig', 'manual.sig'], cwd);
  assert.equal(resigned.code, 0, resigned.err);
  assert.equal((await cli(['verify-log', logFile, '--pubkey', 'keys/warrant-signing.pub', '--sig', 'manual.sig'], cwd)).code, 0);
});

test('CLI: signing errors and bad options are usage errors (exit 2), never a stack trace', async () => {
  const cwd = tmp('cli-bad');
  for (const argv of [
    ['run', path.join(EXAMPLE, 'spec.json'), '--dir', 'w', '--sign-key', 'missing.key'],
    ['run', path.join(EXAMPLE, 'spec.json'), '--dir', 'w2', '--format', 'yaml'],
    ['sign-log', 'nope.log', '--key', 'k'],
    ['sign-log', 'nope.log'],
    ['verify-log', path.join(__dirname, '..', 'viewer', 'samples', 'honest.jsonl'), '--sig', 'x.sig'],
    ['keygen', 'extra'],
  ]) {
    const r = await cli(argv, cwd);
    assert.equal(r.code, 2, `${argv.join(' ')} -> ${r.code}: ${r.err}`);
    assert.ok(!/\n\s+at /.test(r.err), 'no stack trace');
  }
  // the bad key is reported before the run starts: no log was written
  assert.equal(fs.existsSync(path.join(cwd, 'w')), false);
});

test('CLI: --format text prints one line per task and the run status; verify-log text names each check', async () => {
  const cwd = tmp('cli-text');
  const lying = await cli(['run', path.join(EXAMPLE, 'spec-lying.json'), '--dir', 'w', '--format', 'text'], cwd);
  assert.equal(lying.code, 1);
  assert.match(lying.out, /✘ sort\s+failed\s+2 attempts\s+GATE_FAILED: gate failed: exact, is-sorted/);
  assert.match(lying.out, /○ summarize\s+blocked/);
  assert.match(lying.out, /^failed: 1 succeeded, 1 failed, 1 blocked$/m);
  assert.ok(!lying.out.includes('\u001b['), 'no colour codes when the output is not a terminal');
  const verify = await cli(['verify-log', path.join(cwd, 'w', 'run-pipeline-lying', 'run.log'), '--spec', path.join(EXAMPLE, 'spec-lying.json'), '--format', 'text'], cwd);
  assert.equal(verify.code, 0);
  assert.match(verify.out, /✔ hash chain/);
  assert.match(verify.out, /✔ invariants\s+I1-I8 hold, 0 violations/);
});
