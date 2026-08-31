'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { Engine, resumeGated } = require('../src/engine/engine');
const { auditLog } = require('../src/engine/replay');
const { FileRunLog, MemoryRunLog } = require('../src/log/runlog');
const { validateRunSpec } = require('../src/core/spec');
const { main } = require('../src/cli/main');
const { ReceiptWorker } = require('../src/workers/receipt-worker');
const { FILES, markIntent, sha256Hex, verifyReceipt, writeFileAtomic, writeReceipt } = require('../src/workers/receipt');
const { sha } = require('./helpers');

const RECEIPT_MODULE = path.resolve(__dirname, '..', 'src', 'workers', 'receipt.js');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-${p}-`));
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// A command that follows the receipt protocol, with a per-attempt behaviour chosen by argv[3] ("mode1,mode2,..."; the
// last mode repeats). Every mode that reaches the effect appends one line to the ledger, which is the ground truth for
// "how many times did the external effect happen".
const COMMAND = `
const fs = require('node:fs');
const { markIntent, writeReceipt } = require(${JSON.stringify(RECEIPT_MODULE)});
const [ledger, modes] = process.argv.slice(2);
const list = modes.split(',');
const mode = list[Math.min(Number(process.env.WARRANT_ATTEMPT), list.length) - 1];
const key = process.env.WARRANT_IDEMPOTENCY_KEY;
const body = JSON.stringify({ done: true, key });
if (mode === 'die-before-intent') process.exit(3);
markIntent();
fs.appendFileSync(ledger, 'effect ' + key + '\\n');
if (mode === 'die-after-effect') process.exit(3);
fs.writeFileSync('out', body);
if (mode === 'no-receipt') process.exit(0);
writeReceipt({ outputs: ['out'] });
if (mode === 'tampered') fs.writeFileSync('out', body + ' ');
`;

const RUN_ID = 'run-rc';
const KEY = `${RUN_ID}:pay`;
const GOOD_OUTPUT = JSON.stringify({ done: true, key: KEY });

function rig(modes, { receipt = true, effect = 'external-nonrepeatable' } = {}) {
  const dir = tmp('rc');
  const script = path.join(dir, 'cmd.js');
  fs.writeFileSync(script, COMMAND);
  const ledger = path.join(dir, 'ledger.txt');
  const pay = {
    id: 'pay', deps: [], effect, deadline_ms: 8000, max_attempts: 3, outputs: ['out'],
    exec: { argv: ['node', script, ledger, modes], ...(receipt ? { receipt: true } : {}) },
    requirements: [{ id: 'exact', kind: 'artifact_sha256', artifact: 'out', sha256: sha(GOOD_OUTPUT) }],
  };
  const after = { id: 'after', deps: ['pay'], effect: 'pure', deadline_ms: 8000, max_attempts: 1, outputs: ['out'], requirements: [], trust_worker: true, exec: { argv: ['node', '-e', "require('fs').writeFileSync('out','x')"] } };
  const spec = { spec_version: '1', run_id: RUN_ID, max_concurrency: 2, tasks: [pay, after] };
  return { dir, ledger, spec, baseDir: path.join(dir, 'attempts'), attemptDir: (n) => path.join(dir, 'attempts', RUN_ID, `pay.${n}`) };
}

const newWorker = (r, Cls = ReceiptWorker) => new Cls({ baseDir: r.baseDir });

async function run(r, worker = newWorker(r), log = new MemoryRunLog()) {
  const engine = new Engine(r.spec, { worker, log, workDirFor: (a) => worker.workDirFor(a) });
  const report = await engine.run();
  return { report, log, violations: auditLog(engine.spec, log.entries()) };
}

const reconcileOutcomes = (log) => log.entries().filter((e) => e.type === 'reconcile').map((e) => e.data.outcome);

test('receipt: a command that follows the protocol succeeds, is gated, and leaves intent, receipt and attempt records', async () => {
  const r = rig('ok');
  const { report, violations } = await run(r);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.pay.code, 'VERIFIED');
  assert.equal(report.tasks.pay.attempts, 1);
  assert.equal(lines(r.ledger).length, 1);
  assert.deepEqual(violations, []);
  const dir = r.attemptDir(1);
  for (const name of [FILES.attempt, FILES.intent, FILES.receipt]) assert.ok(fs.existsSync(path.join(dir, name)), name);
  const record = JSON.parse(fs.readFileSync(path.join(dir, FILES.attempt), 'utf8'));
  assert.equal(record.exit, 0);
  assert.ok(Number.isInteger(record.pid) && record.pid > 0);
  assert.equal(record.idempotency_key, KEY);
});

test('receipt: CRASH AFTER EFFECT (worker dies, result lost): reconcile reads the receipt, the gate verifies it, the effect is not repeated', async () => {
  class LosesTheResult extends ReceiptWorker {
    async execute(info, ctx) {
      if (info.taskId !== 'pay') return super.execute(info, ctx);
      await super.execute(info, { ...ctx, deliver: () => {} }); // the command really runs to completion; nobody hears about it
      throw new Error('worker crashed after the effect');
    }
  }
  const r = rig('ok');
  const { report, log, violations } = await run(r, newWorker(r, LosesTheResult));
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.pay.code, 'VERIFIED', 'recovered output went through the gate like any other');
  assert.equal(report.tasks.pay.attempts, 1, 'no second attempt');
  assert.equal(lines(r.ledger).length, 1, 'the external effect happened exactly once');
  assert.deepEqual(reconcileOutcomes(log), ['applied']);
  assert.deepEqual(violations, []);
});

test('receipt: CRASH AFTER EFFECT (orchestrator dies before recording the result): resume reconciles from the receipt on disk', async () => {
  class Crash extends Error {}
  class CrashAt {
    constructor(inner, type) { this.inner = inner; this.type = type; }
    append(type, fields, t) { if (type === this.type) throw new Crash(`crash before ${type}`); return this.inner.append(type, fields, t); }
    entries() { return this.inner.entries(); }
    head() { return this.inner.head(); }
    close() { this.inner.close(); }
  }
  const r = rig('ok');
  const logFile = path.join(r.dir, 'run.log');

  const first = new FileRunLog(logFile);
  const worker1 = newWorker(r);
  const doomed = new Engine(r.spec, { worker: worker1, log: new CrashAt(first, 'attempt_result'), workDirFor: (a) => worker1.workDirFor(a) });
  await assert.rejects(doomed.run(), Crash);
  first.close();
  assert.equal(lines(r.ledger).length, 1, 'the command ran to completion before the orchestrator died');
  assert.ok(!first.entries().some((e) => e.type === 'attempt_result'), 'the result was never logged');

  const second = new FileRunLog(logFile);
  const worker2 = newWorker(r);
  try {
    const report = await resumeGated(r.spec, { worker: worker2, log: second, workDirFor: (a) => worker2.workDirFor(a) });
    assert.equal(report.status, 'succeeded');
    assert.equal(report.tasks.pay.code, 'VERIFIED');
    assert.equal(report.tasks.pay.attempts, 1, 'the lost attempt was recovered, not redone');
    assert.equal(report.tasks.after.status, 'succeeded', 'dependants ran once the recovered result passed the gate');
    assert.deepEqual(reconcileOutcomes(second), ['applied']);
    assert.deepEqual(auditLog(r.spec, second.entries()), []);
  } finally {
    second.close();
  }
  assert.equal(lines(r.ledger).length, 1, 'still exactly one effect after recovery');
});

test('receipt: a command that died BEFORE its effect is proven not applied, so the engine runs it again; the effect still happens once', async () => {
  const r = rig('die-before-intent,ok');
  const { report, log, violations } = await run(r);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.pay.attempts, 2);
  assert.deepEqual(reconcileOutcomes(log), ['not_applied']);
  assert.equal(lines(r.ledger).length, 1);
  assert.deepEqual(violations, []);
});

test('receipt: a command that died AFTER its effect without a receipt is ambiguous: unknown, not retried, effect not repeated', async () => {
  const r = rig('die-after-effect,ok');
  const { report, log } = await run(r);
  assert.equal(report.tasks.pay.status, 'unknown');
  assert.equal(report.tasks.pay.code, 'AMBIGUOUS_EFFECT');
  assert.equal(report.tasks.pay.attempts, 1);
  assert.equal(report.tasks.after.status, 'blocked');
  assert.deepEqual(reconcileOutcomes(log), ['inconclusive']);
  assert.equal(lines(r.ledger).length, 1, 'never repeated on a guess');
});

test('receipt: exit 0 without a receipt is a contract violation: unknown, not retried', async () => {
  const r = rig('no-receipt,ok');
  const { report } = await run(r);
  assert.equal(report.tasks.pay.status, 'unknown');
  assert.equal(report.tasks.pay.attempts, 1);
  assert.equal(lines(r.ledger).length, 1);
});

test('receipt: an output changed after the receipt was written does not match it and is never accepted', async () => {
  const r = rig('tampered,ok');
  const { report } = await run(r);
  assert.equal(report.tasks.pay.status, 'unknown');
  assert.notEqual(report.tasks.pay.code, 'VERIFIED');
  assert.equal(report.tasks.pay.attempts, 1);
  assert.equal(lines(r.ledger).length, 1);
});

test('receipt: without "receipt": true the task runs as under CommandWorker, writes no attempt record, and cannot be reconciled', async () => {
  const r = rig('die-after-effect', { receipt: false });
  const { report, log } = await run(r);
  assert.equal(report.tasks.pay.status, 'unknown');
  assert.equal(report.tasks.pay.attempts, 1);
  assert.deepEqual(reconcileOutcomes(log), ['inconclusive']);
  assert.ok(!fs.existsSync(path.join(r.attemptDir(1), FILES.attempt)));
  assert.equal(lines(r.ledger).length, 1);
});

test('receipt: an idempotent task under the receipt worker is simply re-run when it dies (reconcile is only for non-repeatable work)', async () => {
  const r = rig('die-before-intent,ok', { effect: 'external-idempotent' });
  const { report, log } = await run(r);
  assert.equal(report.tasks.pay.status, 'succeeded');
  assert.equal(report.tasks.pay.attempts, 2);
  assert.deepEqual(reconcileOutcomes(log), []);
});

// ----------------------------------------------------------------------------- reconcile, from files alone

function attemptFixture(overrides = {}) {
  const worker = new ReceiptWorker({ baseDir: tmp('fixture') });
  const info = { runId: 'run-x', taskId: 't', attemptId: 't.1', idempotencyKey: 'run-x:t', task: { id: 't', effect: 'external-nonrepeatable', outputs: ['out'] } };
  const dir = worker.attemptDir(info.runId, info.attemptId);
  fs.mkdirSync(dir, { recursive: true });
  const record = { version: 1, run_id: 'run-x', task: 't', attempt: 't.1', idempotency_key: 'run-x:t', pid: 2_000_000_000, exit: 1, ...overrides };
  writeFileAtomic(path.join(dir, FILES.attempt), JSON.stringify(record));
  return { worker, info, dir };
}

const rejectsWith = (promise, code) => assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });

test('reconcile: no attempt record, or a record for another attempt, is inconclusive', async () => {
  const { worker, info, dir } = attemptFixture();
  fs.rmSync(path.join(dir, FILES.attempt));
  await rejectsWith(worker.reconcile(info), 'NO_ATTEMPT_RECORD');
  writeFileAtomic(path.join(dir, FILES.attempt), JSON.stringify({ version: 1, run_id: 'run-x', task: 'other', attempt: 't.1', idempotency_key: 'run-x:t', pid: 2_000_000_000, exit: 1 }));
  await rejectsWith(worker.reconcile(info), 'ATTEMPT_RECORD_MISMATCH');
  writeFileAtomic(path.join(dir, FILES.attempt), '{{{ not json');
  await rejectsWith(worker.reconcile(info), 'RECORD_INVALID');
});

test('reconcile: a dead process that exited non-zero and never wrote intent is the one case that proves "not applied"', async () => {
  const { worker, info } = attemptFixture();
  assert.deepEqual(await worker.reconcile(info), { applied: false });
});

test('reconcile: every other absence of a receipt is inconclusive', async () => {
  const unknownPid = attemptFixture({ pid: null });
  await rejectsWith(unknownPid.worker.reconcile(unknownPid.info), 'PID_UNKNOWN');

  const exitedZero = attemptFixture({ exit: 0 });
  await rejectsWith(exitedZero.worker.reconcile(exitedZero.info), 'EXITED_WITHOUT_RECEIPT');

  const intent = attemptFixture();
  markIntent({ dir: intent.dir });
  await rejectsWith(intent.worker.reconcile(intent.info), 'INTENT_WITHOUT_RECEIPT');
});

test('reconcile: while the process may still be running nothing is concluded; once it is gone, absence of intent is conclusive', async () => {
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => sleeper.on('exit', resolve));
  try {
    const { worker, info } = attemptFixture({ pid: sleeper.pid });
    await rejectsWith(worker.reconcile(info), 'PROCESS_MAY_BE_RUNNING');
    sleeper.kill();
    await exited;
    assert.deepEqual(await worker.reconcile(info), { applied: false });
  } finally {
    sleeper.kill();
  }
});

test('reconcile: a receipt that is forged, stale, truncated or inconsistent with the outputs is never believed', async () => {
  const good = (dir, overrides = {}) => {
    fs.writeFileSync(path.join(dir, 'out'), 'payload');
    writeFileAtomic(path.join(dir, FILES.receipt), JSON.stringify({ version: 1, idempotency_key: 'run-x:t', outputs: { out: sha256Hex('payload') }, ...overrides }));
  };

  const ok = attemptFixture();
  good(ok.dir);
  assert.deepEqual(await ok.worker.reconcile(ok.info), { applied: true, artifacts: { out: 'payload' } });

  const wrongKey = attemptFixture();
  good(wrongKey.dir, { idempotency_key: 'run-other:t' });
  await rejectsWith(wrongKey.worker.reconcile(wrongKey.info), 'RECEIPT_KEY_MISMATCH');

  const wrongVersion = attemptFixture();
  good(wrongVersion.dir, { version: 2 });
  await rejectsWith(wrongVersion.worker.reconcile(wrongVersion.info), 'RECEIPT_VERSION');

  const noDigest = attemptFixture();
  good(noDigest.dir, { outputs: {} });
  await rejectsWith(noDigest.worker.reconcile(noDigest.info), 'RECEIPT_INVALID');

  const badDigest = attemptFixture();
  good(badDigest.dir, { outputs: { out: 'zz' } });
  await rejectsWith(badDigest.worker.reconcile(badDigest.info), 'RECEIPT_INVALID');

  const changed = attemptFixture();
  good(changed.dir);
  fs.writeFileSync(path.join(changed.dir, 'out'), 'payload!');
  await rejectsWith(changed.worker.reconcile(changed.info), 'OUTPUT_DIGEST_MISMATCH');

  const missing = attemptFixture();
  good(missing.dir);
  fs.rmSync(path.join(missing.dir, 'out'));
  await rejectsWith(missing.worker.reconcile(missing.info), 'OUTPUT_MISSING');

  const truncated = attemptFixture();
  good(truncated.dir);
  fs.writeFileSync(path.join(truncated.dir, FILES.receipt), '{"version":1,"idempotency_ke');
  await rejectsWith(truncated.worker.reconcile(truncated.info), 'RECORD_INVALID');
});

test('reconcile: an output that is a symlink to a host file is refused rather than followed', async (t) => {
  const { worker, info, dir } = attemptFixture();
  const secret = path.join(tmp('secret'), 'private.txt');
  fs.writeFileSync(secret, 'host secret');
  try { fs.symlinkSync(secret, path.join(dir, 'out')); } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('this account may not create symlinks'); return; }
    throw error;
  }
  writeFileAtomic(path.join(dir, FILES.receipt), JSON.stringify({ version: 1, idempotency_key: 'run-x:t', outputs: { out: sha256Hex('host secret') } }));
  await rejectsWith(worker.reconcile(info), 'OUTPUT_MISSING');
});

// ----------------------------------------------------------------------------- helpers, spec, CLI

test('receipt files: writes are atomic (no temp debris, replaces an existing file) and receipts hash the output bytes', () => {
  const dir = tmp('atomic');
  const file = path.join(dir, 'x.json');
  writeFileAtomic(file, 'one');
  writeFileAtomic(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);

  fs.writeFileSync(path.join(dir, 'out'), 'bytes');
  writeReceipt({ outputs: ['out'], dir, idempotencyKey: 'k' });
  const verified = verifyReceipt({ dir, idempotencyKey: 'k', outputs: ['out'], readOutput: (d, n) => fs.readFileSync(path.join(d, n), 'utf8') });
  assert.deepEqual(verified, { artifacts: { out: 'bytes' } });
  assert.equal(verifyReceipt({ dir: tmp('empty'), idempotencyKey: 'k', outputs: ['out'], readOutput: () => null }), null);
  assert.throws(() => markIntent({ dir: undefined }), /WARRANT_ATTEMPT_DIR/);
});

test('spec: exec.receipt must be a boolean and unknown exec fields are still rejected', () => {
  const base = () => ({
    spec_version: '1', run_id: 'run-s', max_concurrency: 1,
    tasks: [{ id: 'a', deps: [], effect: 'external-nonrepeatable', deadline_ms: 1000, max_attempts: 1, outputs: ['out'], requirements: [], trust_worker: true, exec: { argv: ['node', '-v'] } }],
  });
  assert.equal(validateRunSpec(base()).ok, true);
  const withReceipt = base();
  withReceipt.tasks[0].exec.receipt = true;
  assert.equal(validateRunSpec(withReceipt).ok, true);
  const bad = base();
  bad.tasks[0].exec.receipt = 'yes';
  assert.match(validateRunSpec(bad).errors.join('\n'), /exec\.receipt must be a boolean/);
  const unknown = base();
  unknown.tasks[0].exec.shell = true;
  assert.match(validateRunSpec(unknown).errors.join('\n'), /unknown field "shell"/);
});

test('CLI: crash-after-effect recovery through `warrant resume` with a real subprocess (the shipped example)', async () => {
  const cwd = tmp('cli-receipt');
  const ledger = path.join(cwd, 'ledger.txt');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'receipt', 'spec.json'), 'utf8'));
  spec.tasks[0].exec.argv = ['node', path.join(__dirname, '..', 'examples', 'receipt', 'charge.js'), ledger];
  const specFile = path.join(cwd, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const cli = async (argv) => {
    let out = '';
    let err = '';
    const code = await main(argv, { cwd, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
    return { code, out, err };
  };
  assert.equal((await cli(['run', specFile, '--dir', 'work'])).code, 0);
  const logFile = path.join(cwd, 'work', 'run-receipt', 'run.log');
  const entries = lines(logFile);
  fs.writeFileSync(logFile, `${entries.slice(0, entries.findIndex((l) => l.includes('"attempt_started"')) + 1).join('\n')}\n`);
  const resumed = await cli(['resume', specFile, '--log', logFile, '--dir', 'work']);
  assert.equal(resumed.code, 0, resumed.err);
  assert.equal(JSON.parse(resumed.out).tasks.charge.attempts, 1);
  assert.equal(lines(ledger).length, 1);
  assert.ok(lines(logFile).some((l) => l.includes('"reconcile"') && l.includes('"applied"')));
});

test('example: examples/receipt/demo.js runs end to end and reports success', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'examples', 'receipt', 'demo.js')], { encoding: 'utf8' });
  assert.match(out, /reconcile outcome "applied"/);
  assert.match(out, /^ok: /m);
});
