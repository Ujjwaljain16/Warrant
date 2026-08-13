'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startNaiveParallel, startSequential } = require('../src/engine/baselines');
const { VirtualClock } = require('../src/sim/clock');
const { FakeWorker } = require('../src/sim/fake-worker');
const { ScriptedPlan } = require('../src/sim/faultplan');
const { World } = require('../src/sim/world');
const { compileWorkload } = require('../src/bench/workloads');
const { d } = require('./sim-helpers');

async function runBaseline(kind, draft, script = {}, { cancelAt = null, runCapMs = Infinity, deadlines = false, reconcile = true } = {}) {
  const workload = compileWorkload('mini', draft);
  const clock = new VirtualClock();
  const world = new World(workload.spec.tasks);
  const worker = new FakeWorker({ world, plan: new ScriptedPlan(script, { reconcileAvailable: reconcile }), clock });
  const events = [];
  const observer = (e) => events.push(e);
  const handle = kind === 'sequential'
    ? startSequential(workload.spec, { worker, clock, observer, runCapMs })
    : startNaiveParallel(workload.spec, { worker, clock, observer, runCapMs, deadlines });
  if (cancelAt !== null) clock.setTimeout(() => handle.cancel(), cancelAt);
  const report = await clock.run(handle.promise);
  world.closeAll(clock.now());
  return { report, world, events, clock, workload };
}

test('baselines trust the claim: a well-formed wrong result is accepted as success (this is what the gate adds)', async () => {
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report, workload } = await runBaseline(kind, [d('a')], { 'a.1': { kind: 'false_claim' } });
    assert.equal(report.tasks.a.status, 'succeeded', kind);
    assert.notEqual(report.tasks.a.artifacts_digest, workload.expected.a, `${kind} accepted the wrong content`);
  }
});

test('baselines do check envelope structure: a missing artifact is a failure and is retried', async () => {
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report, workload } = await runBaseline(kind, [d('a')], { 'a.1': { kind: 'invalid' } });
    assert.equal(report.tasks.a.status, 'succeeded', kind);
    assert.equal(report.tasks.a.attempts, 2, kind);
    assert.equal(report.tasks.a.artifacts_digest, workload.expected.a, `${kind}: the retry produced the correct output`);
  }
});

test('baselines retry crashes up to the shared budget and then fail', async () => {
  const crash = { kind: 'crash_before' };
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report } = await runBaseline(kind, [d('a'), d('b', ['a'])], { 'a.1': crash, 'a.2': crash, 'a.3': crash });
    assert.equal(report.tasks.a.status, 'failed', kind);
    assert.equal(report.tasks.a.attempts, 3, kind);
    assert.equal(report.tasks.b.status, 'blocked', kind);
  }
});

test('baselines repeat a non-repeatable effect after a crash that followed it (no reconcile, no journal)', async () => {
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report, world } = await runBaseline(kind, [d('a', [], 'external-nonrepeatable')], { 'a.1': { kind: 'crash_after' } });
    assert.equal(report.tasks.a.status, 'succeeded', kind);
    assert.equal(world.effectCount('a'), 2, `${kind}: the irreversible effect happened twice`);
  }
});

test('sequential is immune to duplicate deliveries; naive-parallel releases a join early and violates dependency order', async () => {
  const draft = [d('a'), { ...d('b'), nominal_ms: 300 }, d('c', ['a', 'b'])];
  const script = { 'a.1': { duplicate: true } };
  const seq = await runBaseline('sequential', draft, script);
  assert.ok(seq.events.filter((e) => e.type === 'dispatch').every((e) => e.deps_ok));
  assert.equal(seq.report.status, 'succeeded');

  const naive = await runBaseline('naive-parallel', draft, script);
  const early = naive.events.filter((e) => e.type === 'dispatch' && e.task === 'c');
  assert.equal(early.length, 1);
  assert.equal(early[0].deps_ok, false, 'c was dispatched before b finished');
  assert.notEqual(naive.report.tasks.c.artifacts_digest, naive.workload.expected.c, 'and built its output on a missing input');
  assert.equal(naive.report.tasks.c.status, 'succeeded', 'while still reporting success');
});

test('a hung worker stalls the baselines until the run-level cap, which leaves the work UNKNOWN and flags the run incomplete', async () => {
  const hang = { 'a.1': { kind: 'hang' } };
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report, clock } = await runBaseline(kind, [d('a'), d('b', ['a'])], hang, { runCapMs: 5000 });
    assert.equal(report.incomplete, true, kind);
    assert.equal(report.tasks.a.status, 'unknown', kind);
    assert.equal(clock.now(), 5000, `${kind} waited for the cap`);
  }
});

test('naive-parallel-timeout aborts a hung attempt at its deadline and retries it, but still repeats non-repeatable effects', async () => {
  const hung = await runBaseline('naive-parallel', [d('a')], { 'a.1': { kind: 'hang' } }, { deadlines: true, runCapMs: 100000 });
  assert.equal(hung.report.tasks.a.status, 'succeeded');
  assert.equal(hung.report.tasks.a.attempts, 2);
  assert.equal(hung.report.incomplete, false);
  assert.equal(hung.world.open.size, 0, 'the hung attempt was aborted and closed');

  // delay: the effect lands at ~270ms, the 300ms deadline fires before the result at 600ms, and the retry applies it again.
  const slow = await runBaseline('naive-parallel', [d('a', [], 'external-nonrepeatable')], { 'a.1': { kind: 'delay' } }, { deadlines: true, runCapMs: 100000 });
  assert.equal(slow.report.tasks.a.status, 'succeeded');
  assert.equal(slow.world.effectCount('a'), 2);
});

test('naive-parallel-timeout ignores a timed-out attempt\'s late answer', async () => {
  // Same shape as the gated late-result test, expressed via the fake worker ignoring aborts: use delay with no abort support.
  const { report, events } = await runBaseline('naive-parallel', [d('a')], { 'a.1': { kind: 'delay' } }, { deadlines: true, runCapMs: 100000 });
  assert.equal(report.tasks.a.status, 'succeeded');
  assert.equal(report.tasks.a.attempts, 2);
  assert.equal(events.filter((e) => e.type === 'settled' && e.task === 'a').length, 1, 'counted once');
});

test('baseline cancellation only stops NEW work: in-flight tasks finish and their effects land after the request', async () => {
  const draft = [d('a'), d('b'), d('c', ['a'])];
  for (const kind of ['sequential', 'naive-parallel']) {
    const { report, world } = await runBaseline(kind, draft, {}, { cancelAt: 30 });
    const started = Object.values(report.tasks).filter((t) => t.attempts > 0).length;
    assert.ok(started >= 1, kind);
    const landed = [...world.effects.values()].flatMap((e) => e.times).filter((t) => t > 30).length;
    assert.ok(landed >= 1, `${kind}: effects happened after the cancel request`);
    assert.equal(report.tasks.c.status, 'cancelled', `${kind}: not-yet-started work is cancelled`);
    assert.notEqual(report.tasks.c.attempts, 1);
  }
});
