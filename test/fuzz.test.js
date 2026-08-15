'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/engine/engine');
const { auditLog } = require('../src/engine/replay');
const { MemoryRunLog } = require('../src/log/runlog');
const { VirtualClock } = require('../src/sim/clock');
const { FakeWorker } = require('../src/sim/fake-worker');
const { unit } = require('../src/sim/rng');
const { World } = require('../src/sim/world');
const { compileWorkload } = require('../src/bench/workloads');

// Property-based test: random DAGs, effect classes, fault-rate mixes, cancel times and reconcile availability.
// Cases are a pure function of the case number, so a failure is reproducible with FUZZ_CASE=<n>.
// The ground truth is the workload's known-correct digests and the world's effect ledger, never the engine's report.

const EFFECTS = ['pure', 'workspace-reversible', 'external-idempotent', 'external-nonrepeatable'];
const CASES = Number(process.env.FUZZ_CASES) || 300;
const ONLY = process.env.FUZZ_CASE === undefined ? null : Number(process.env.FUZZ_CASE);

class RatePlan {
  constructor(seed, rates, reconcileAvailable) {
    this.seed = seed;
    this.rates = rates;
    this.reconcileAvailable = reconcileAvailable;
    this.cancelAt = null;
  }

  fate(taskId, attemptNo) {
    const u = unit(`${this.seed}|${taskId}|${attemptNo}|fate`);
    let acc = 0;
    let kind = 'normal';
    for (const k of ['crash_before', 'crash_after', 'hang', 'delay', 'invalid', 'false_claim', 'permanent_failure']) {
      acc += this.rates[k];
      if (u < acc) { kind = k; break; }
    }
    return { kind, duplicate: unit(`${this.seed}|${taskId}|${attemptNo}|dup`) < this.rates.duplicate };
  }
}

function makeCase(n) {
  const r = (label) => unit(`fuzz|${n}|${label}`);
  const size = 1 + Math.floor(r('size') * 18);
  const draft = [];
  for (let i = 0; i < size; i++) {
    const deps = [];
    for (let j = 0; j < i && deps.length < 4; j++) if (r(`edge|${j}|${i}`) < 0.3) deps.push(`t${j}`);
    draft.push({ id: `t${i}`, deps, effect: EFFECTS[Math.floor(r(`effect|${i}`) * 4)], nominal_ms: 20 + Math.floor(r(`lat|${i}`) * 180) });
  }
  const rate = (label, max) => (r(`rate|${label}`) < 0.5 ? 0 : r(`rateval|${label}`) * max);
  const rates = {
    crash_before: rate('cb', 0.2), crash_after: rate('ca', 0.2), hang: rate('hang', 0.1), delay: rate('delay', 0.2),
    invalid: rate('inv', 0.2), false_claim: rate('fc', 0.2), permanent_failure: rate('pf', 0.05), duplicate: rate('dup', 0.4),
  };
  return {
    draft, rates,
    concurrency: 1 + Math.floor(r('conc') * 6),
    reconcile: r('reconcile') < 0.6,
    cancelAt: r('cancel') < 0.3 ? 20 + Math.floor(r('cancelat') * 400) : null,
    seed: n,
  };
}

// ~25% of tasks get an extra host-side predicate requirement whose outcome is true, false, or an error (thrown).
// The ledger records the outcome of each evaluation so the test can check that success implies the predicate held.
function withPredicates(n, workload) {
  const spec = JSON.parse(JSON.stringify(workload.spec));
  const guarded = new Set();
  for (const task of spec.tasks) {
    if (unit(`fuzz|${n}|pred|${task.id}`) < 0.25) {
      task.requirements.push({ id: 'host-check', kind: 'predicate', name: `check-${task.id}` });
      guarded.add(task.id);
    }
  }
  return { spec, guarded };
}

async function runCase(n) {
  const c = makeCase(n);
  const base = compileWorkload(`fuzz${n}`, c.draft, { maxConcurrency: c.concurrency });
  const { spec, guarded } = withPredicates(n, base);
  const workload = { ...base, spec: require('../src/core/spec').assertRunSpec(spec) };
  const lastPredicate = new Map(); // task -> outcome of its most recent evaluation: 'true' | 'false' | 'error'
  const calls = new Map();
  const predicates = {};
  for (const id of guarded) {
    predicates[`check-${id}`] = () => {
      const k = (calls.get(id) || 0) + 1;
      calls.set(id, k);
      const u = unit(`fuzz|${n}|predval|${id}|${k}`);
      if (u < 0.15) { lastPredicate.set(id, 'error'); throw new Error('verifier crashed'); }
      if (u < 0.3) { lastPredicate.set(id, 'false'); return false; }
      lastPredicate.set(id, 'true');
      return true;
    };
  }
  const clock = new VirtualClock();
  const world = new World(workload.spec.tasks);
  const plan = new RatePlan(c.seed, c.rates, c.reconcile);
  const worker = new FakeWorker({ world, plan, clock });
  const log = new MemoryRunLog();
  const events = [];
  const engine = new Engine(workload.spec, { worker, clock, log, gateCostMs: 5, predicates, observer: (e) => events.push(e) });
  if (c.cancelAt !== null) clock.setTimeout(() => engine.cancel('FUZZ_CANCEL'), c.cancelAt);
  const report = await clock.run(engine.run());
  world.closeAll(clock.now());
  return { c, workload, world, report, log, events, clock, guarded, lastPredicate };
}

test(`fuzz: ${CASES} random runs hold every invariant against ground truth`, async () => {
  const stats = { cancelled: 0, succeeded: 0, unknown: 0, failed: 0, nonrepeatableUnknown: 0, cases: 0 };
  const first = ONLY === null ? 0 : ONLY;
  const last = ONLY === null ? CASES : ONLY + 1;
  for (let n = first; n < last; n++) {
    let out;
    try { out = await runCase(n); } catch (error) { throw new Error(`case ${n} threw (reproduce: FUZZ_CASE=${n}): ${error.stack}`); }
    const { c, workload, world, report, log, events, guarded, lastPredicate } = out;
    const label = `case ${n} (reproduce: FUZZ_CASE=${n})`;

    assert.deepEqual(auditLog(workload.spec, log.entries()), [], `${label}: log audit`);
    assert.equal(report.unquiesced_workers, 0, `${label}: workers stopped`);
    assert.ok(Object.values(report.tasks).every((t) => ['succeeded', 'failed', 'blocked', 'unknown', 'cancelled'].includes(t.status)), `${label}: all tasks terminal`);
    assert.ok(events.filter((e) => e.type === 'dispatch').every((e) => e.deps_ok), `${label}: I2 dispatch order`);
    assert.ok(Math.max(0, ...events.filter((e) => e.type === 'dispatch').map((e) => e.inflight)) <= c.concurrency, `${label}: I3 concurrency`);
    assert.equal(world.open.size, 0, `${label}: no attempt left open`);

    for (const task of workload.spec.tasks) {
      const t = report.tasks[task.id];
      assert.ok(t.attempts <= task.max_attempts, `${label}: ${task.id} attempts`);
      if (t.status === 'succeeded') {
        assert.equal(t.artifacts_digest, workload.expected[task.id], `${label}: ${task.id} FALSE SUCCESS`);
        for (const dep of task.deps) assert.equal(report.tasks[dep].status, 'succeeded', `${label}: ${task.id} succeeded over non-succeeded ${dep}`);
      }
      if (guarded.has(task.id) && t.status === 'succeeded') assert.equal(lastPredicate.get(task.id), 'true', `${label}: ${task.id} succeeded although its host-side predicate did not hold on the last evaluation`);
      if (t.status === 'unknown' && t.verification && t.verification.not_verified.length) assert.ok(t.verification.not_verified.every((id) => task.requirements.some((r) => r.id === id)), `${label}: unknown names only real requirements`);
      if (t.status === 'blocked') assert.equal(t.attempts, 0, `${label}: blocked ${task.id} must never have run`);
      if (task.effect === 'external-nonrepeatable') assert.ok(world.effectCount(task.id) <= 1, `${label}: ${task.id} non-repeatable effect applied ${world.effectCount(task.id)} times`);
    }

    if (c.cancelAt !== null && report.status === 'cancelled') {
      const cancelSeq = log.entries().find((e) => e.type === 'cancel_requested').seq;
      assert.ok(log.entries().filter((e) => e.type === 'attempt_started').every((e) => e.seq < cancelSeq), `${label}: I7`);
      for (const task of workload.spec.tasks) for (const at of world.effects.get(task.id).times) assert.ok(at <= c.cancelAt, `${label}: effect after cancel on ${task.id}`);
    }
    if (report.status === 'succeeded') assert.ok(Object.values(report.tasks).every((t) => t.status === 'succeeded'), `${label}: run success means every task`);
    if (report.status === 'unknown') assert.ok(Object.values(report.tasks).some((t) => t.status === 'unknown'));

    stats.cases++;
    for (const t of Object.values(report.tasks)) if (stats[t.status] !== undefined) stats[t.status]++;
    if (report.status === 'cancelled') stats.cancelled++;
  }
  // The generator must actually exercise the interesting outcomes, otherwise the invariants above are vacuous.
  if (ONLY === null && CASES >= 300) {
    assert.ok(stats.succeeded > 500 && stats.failed > 20 && stats.unknown > 5 && stats.cancelled > 20, `fuzz did not cover the outcome space: ${JSON.stringify(stats)}`);
  }
});

// Liveness: when every fault is recoverable (the last permitted attempt of every task is healthy, and non-repeatable
// tasks can reconcile), the engine must finish every task as succeeded. This catches regressions that are safe but
// wrongly give up, such as treating a recoverable result as unverifiable or never retrying.
test('fuzz liveness: recoverable faults never prevent completion', async () => {
  let multiAttempt = 0;
  for (let n = 0; n < 300; n++) {
    const r = (label) => unit(`live|${n}|${label}`);
    const size = 1 + Math.floor(r('size') * 14);
    const draft = [];
    for (let i = 0; i < size; i++) {
      const deps = [];
      for (let j = 0; j < i && deps.length < 3; j++) if (r(`edge|${j}|${i}`) < 0.3) deps.push(`t${j}`);
      draft.push({ id: `t${i}`, deps, effect: EFFECTS[Math.floor(r(`effect|${i}`) * 4)], nominal_ms: 20 + Math.floor(r(`lat|${i}`) * 120) });
    }
    const workload = compileWorkload(`live${n}`, draft, { maxConcurrency: 1 + Math.floor(r('conc') * 5) });
    const rates = { crash_before: 0.25, crash_after: 0.25, hang: 0.1, delay: 0.2, invalid: 0.2, false_claim: 0, permanent_failure: 0, duplicate: 0.4 };
    // Attempts 1 and 2 may be faulty; attempt 3 is always healthy, and a healthy attempt always exists within the budget of 3.
    const plan = new RatePlan(n, rates, true);
    const realFate = plan.fate.bind(plan);
    plan.fate = (taskId, attemptNo) => (attemptNo >= 3 ? { kind: 'normal', duplicate: false } : realFate(taskId, attemptNo));
    const clock = new VirtualClock();
    const world = new World(workload.spec.tasks);
    const log = new MemoryRunLog();
    const report = await clock.run(new Engine(workload.spec, { worker: new FakeWorker({ world, plan, clock }), clock, log, gateCostMs: 5 }).run());
    world.closeAll(clock.now());
    const label = `liveness case ${n}`;
    assert.equal(report.status, 'succeeded', `${label}: ${JSON.stringify(Object.entries(report.tasks).filter(([, t]) => t.status !== 'succeeded').map(([id, t]) => [id, t.status, t.code]))}`);
    assert.deepEqual(auditLog(workload.spec, log.entries()), [], label);
    for (const id of workload.nonrepeatable) assert.equal(world.effectCount(id), 1, `${label}: ${id} effect applied exactly once`);
    if (Object.values(report.tasks).some((t) => t.attempts > 1)) multiAttempt++;
  }
  assert.ok(multiAttempt > 150, `the generator exercised retries (${multiAttempt} of 300 cases needed one)`);
});
