'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Engine, resumeGated } = require('../src/engine/engine');
const { ResumeError, auditLog, buildRestore } = require('../src/engine/replay');
const { FileRunLog, MemoryRunLog, readRunLogFile } = require('../src/log/runlog');
const { VirtualClock } = require('../src/sim/clock');
const { FakeWorker } = require('../src/sim/fake-worker');
const { ScriptedPlan, SeededPlan } = require('../src/sim/faultplan');
const { World } = require('../src/sim/world');
const { buildWorkload, compileWorkload } = require('../src/bench/workloads');
const { d } = require('./sim-helpers');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-resume-')), 'run.log');

class Crash extends Error {}

// Wraps a real log and "kills the process" at the nth append, either before or after that entry is persisted.
class CrashingLog {
  constructor(inner, crashAt, when) { this.inner = inner; this.crashAt = crashAt; this.when = when; this.count = 0; }
  append(type, fields, t) {
    this.count++;
    if (this.count === this.crashAt && this.when === 'before') throw new Crash(`crash before append #${this.count}`);
    const entry = this.inner.append(type, fields, t);
    if (this.count === this.crashAt && this.when === 'after') throw new Crash(`crash after append #${this.count}`);
    return entry;
  }
  entries() { return this.inner.entries(); }
  head() { return this.inner.head(); }
  close() { this.inner.close(); }
}

function rig(workload, plan, world = new World(workload.spec.tasks)) {
  const clock = new VirtualClock();
  return { clock, world, worker: new FakeWorker({ world, plan, clock }) };
}

// Run to completion or until the injected crash. Returns { crashed, report }.
async function runWithCrash(workload, plan, world, file, crashAt, when) {
  const { clock, worker } = rig(workload, plan, world);
  const log = new CrashingLog(new FileRunLog(file), crashAt, when);
  try {
    const report = await clock.run(new Engine(workload.spec, { worker, clock, log, gateCostMs: 5 }).run());
    log.close();
    return { crashed: false, report };
  } catch (error) {
    if (!(error instanceof Crash)) throw error;
    log.close();
    return { crashed: true };
  }
}

async function resume(workload, plan, world, file) {
  const { clock, worker } = rig(workload, plan, world);
  const log = new FileRunLog(file);
  try {
    return await clock.run(resumeGated(workload.spec, { worker, clock, log, gateCostMs: 5 }));
  } finally {
    log.close();
  }
}

function assertGroundTruth(workload, world, report, label) {
  for (const [id, t] of Object.entries(report.tasks)) {
    if (t.status === 'succeeded') {
      assert.equal(t.artifacts_digest, workload.expected[id], `${label}: ${id} succeeded with a digest that is not the ground truth`);
    }
  }
  for (const id of workload.nonrepeatable) {
    assert.ok(world.effectCount(id) <= 1, `${label}: non-repeatable task ${id} had its effect applied ${world.effectCount(id)} times`);
  }
}

test('CHAOS: kill the engine at EVERY log-append boundary (before and after persisting), resume from disk, and the invariants hold', async () => {
  const workload = buildWorkload('diamond-lattice-16');
  const cases = [
    { profile: 'none', seed: 1 },
    { profile: 'mixed', seed: 7 },
    { profile: 'crash', seed: 3 },
  ];
  let crashes = 0;
  let resumedToCompletion = 0;
  for (const { profile, seed } of cases) {
    // Length of an uninterrupted run, to know how many boundaries exist.
    const baselineFile = tmpFile();
    const base = await runWithCrash(workload, new SeededPlan({ seed, profile, workload }), new World(workload.spec.tasks), baselineFile, Infinity, 'before');
    const total = readRunLogFile(baselineFile).entries.length;
    assert.equal(base.crashed, false);
    assert.ok(total > 30);
    for (const when of ['before', 'after']) {
      for (let n = 1; n <= total; n++) {
        const label = `${profile}/seed${seed}/${when}#${n}`;
        const file = tmpFile();
        const world = new World(workload.spec.tasks);
        const first = await runWithCrash(workload, new SeededPlan({ seed, profile, workload }), world, file, n, when);
        if (!first.crashed) continue;
        crashes++;
        let report;
        try {
          report = await resume(workload, new SeededPlan({ seed, profile, workload }), world, file);
        } catch (error) {
          if (error instanceof ResumeError && error.code === 'RUN_FINISHED') continue; // died after the final entry: nothing to resume
          throw new Error(`${label}: resume failed: ${error.stack}`);
        }
        resumedToCompletion++;
        const entries = readRunLogFile(file).entries;
        assert.deepEqual(auditLog(workload.spec, entries), [], `${label}: log audit`);
        assertGroundTruth(workload, world, report, label);
        for (const t of Object.values(report.tasks)) assert.notEqual(t.status, 'running', `${label}: no task left running`);
      }
    }
  }
  assert.ok(crashes > 300, `exercised ${crashes} crash points`);
  assert.ok(resumedToCompletion > 300);
});

test('resume: a lost pure attempt is simply run again', async () => {
  const workload = compileWorkload('mini', [d('a'), d('b', ['a'])]);
  const file = tmpFile();
  const world = new World(workload.spec.tasks);
  // Crash right after attempt a.1 is logged as started, before any result.
  const first = await runWithCrash(workload, new ScriptedPlan(), world, file, 2, 'after');
  assert.equal(first.crashed, true);
  const report = await resume(workload, new ScriptedPlan(), world, file);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.a.attempts, 2, 'the interrupted attempt counts against the budget');
  const entries = readRunLogFile(file).entries;
  assert.deepEqual(auditLog(workload.spec, entries), []);
  assert.deepEqual(entries.filter((e) => e.type === 'run_started').map((e) => e.data.resumed), [false, true]);
});

test('resume: a lost NON-repeatable attempt whose effect landed is reconciled and verified, not repeated', async () => {
  const workload = compileWorkload('mini', [d('a', [], 'external-nonrepeatable')]);
  const file = tmpFile();
  const world = new World(workload.spec.tasks);
  // Let the effect land (effect point is 45ms in), then die before the result is logged: crash at the attempt_result append.
  let n = 0;
  for (let i = 1; i < 10 && world.effectCount('a') === 0; i++) {
    const w = new World(workload.spec.tasks);
    const f = tmpFile();
    const r = await runWithCrash(workload, new ScriptedPlan(), w, f, i, 'before');
    if (r.crashed && w.effectCount('a') === 1) { n = i; break; }
  }
  assert.ok(n > 0, 'found a crash point after the effect landed');
  const f2 = tmpFile();
  const w2 = new World(workload.spec.tasks);
  await runWithCrash(workload, new ScriptedPlan(), w2, f2, n, 'before');
  assert.equal(w2.effectCount('a'), 1);
  const report = await resume(workload, new ScriptedPlan(), w2, f2);
  assert.equal(report.tasks.a.status, 'succeeded');
  assert.equal(w2.effectCount('a'), 1, 'effect was not repeated');
  assert.ok(readRunLogFile(f2).entries.some((e) => e.type === 'reconcile' && e.data.outcome === 'applied'));
});

test('resume: a lost NON-repeatable attempt with no way to check becomes UNKNOWN rather than being repeated', async () => {
  const workload = compileWorkload('mini', [d('a', [], 'external-nonrepeatable'), d('b', ['a'])]);
  const plan = () => new ScriptedPlan({}, { reconcileAvailable: false });
  let found = null;
  for (let i = 1; i < 12 && !found; i++) {
    const w = new World(workload.spec.tasks);
    const f = tmpFile();
    const r = await runWithCrash(workload, plan(), w, f, i, 'before');
    if (r.crashed && w.effectCount('a') === 1) found = { w, f };
  }
  assert.ok(found);
  const report = await resume(workload, plan(), found.w, found.f);
  assert.equal(report.tasks.a.status, 'unknown');
  assert.equal(report.tasks.a.code, 'AMBIGUOUS_EFFECT');
  assert.equal(report.tasks.b.status, 'blocked');
  assert.equal(found.w.effectCount('a'), 1);
});

test('resume refuses: a different spec, a finished run, a cancelled run', async () => {
  const workload = compileWorkload('mini', [d('a')]);
  const file = tmpFile();
  const done = await runWithCrash(workload, new ScriptedPlan(), new World(workload.spec.tasks), file, Infinity, 'before');
  assert.equal(done.report.status, 'succeeded');
  const entries = readRunLogFile(file).entries;
  assert.throws(() => buildRestore(workload.spec, entries), (e) => e instanceof ResumeError && e.code === 'RUN_FINISHED');
  const other = compileWorkload('mini', [d('a'), d('z')]);
  assert.throws(() => buildRestore(other.spec, entries), (e) => e.code === 'SPEC_MISMATCH');
  const cancelled = new MemoryRunLog();
  const specDigest = require('../src/core/spec').specDigest(workload.spec);
  cancelled.append('run_started', { data: { spec_digest: specDigest } }, 0);
  cancelled.append('cancel_requested', { data: { reason: 'x' } }, 1);
  assert.throws(() => buildRestore(workload.spec, cancelled.entries()), (e) => e.code === 'RUN_CANCELLED');
});

test('resume fails closed on a tampered or forged log', async () => {
  const workload = compileWorkload('mini', [d('a'), d('b', ['a'])]);
  const specDigest = require('../src/core/spec').specDigest(workload.spec);

  // 1. A valid hash chain that records a success with no gate verdict (forged by someone who can recompute hashes).
  const forged = new MemoryRunLog();
  forged.append('run_started', { data: { spec_digest: specDigest } }, 0);
  forged.append('attempt_started', { task: 'a', attempt: 'a.1', data: { no: 1, key: 'k', effect: 'pure' } }, 1);
  forged.append('task_settled', { task: 'a', attempt: 'a.1', data: { status: 'succeeded', code: 'VERIFIED', digest: `sha256:${'a'.repeat(64)}` } }, 2);
  assert.throws(() => buildRestore(workload.spec, forged.entries()), (e) => e instanceof ResumeError && e.code === 'LOG_INCONSISTENT' && /I1_UNVERIFIED_SUCCESS/.test(e.message));

  // 2. A byte edit in a real log breaks the chain.
  const file = tmpFile();
  await runWithCrash(workload, new ScriptedPlan(), new World(workload.spec.tasks), file, Infinity, 'before');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const tampered = lines[1].replace('"no":1', '"no":2');
  assert.notEqual(tampered, lines[1], 'the edit must actually change the file');
  lines[1] = tampered;
  fs.writeFileSync(file, lines.join('\n'));
  assert.throws(() => new FileRunLog(file), /hash does not match/);
});

test('resume tolerates a torn final write and loses at most the entry being written', async () => {
  const workload = compileWorkload('mini', [d('a'), d('b', ['a'])]);
  const file = tmpFile();
  const world = new World(workload.spec.tasks);
  await runWithCrash(workload, new ScriptedPlan(), world, file, 4, 'after');
  fs.appendFileSync(file, '{"v":1,"seq":5,"t":1,"type":"attempt_res');
  const log = new FileRunLog(file);
  assert.equal(log.repaired, true);
  log.close();
  const report = await resume(workload, new ScriptedPlan(), world, file);
  assert.equal(report.status, 'succeeded');
  assert.deepEqual(auditLog(workload.spec, readRunLogFile(file).entries), []);
});
