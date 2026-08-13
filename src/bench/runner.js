'use strict';

const { Engine } = require('../engine/engine');
const { startNaiveParallel, startSequential } = require('../engine/baselines');
const { auditLog } = require('../engine/replay');
const { MemoryRunLog } = require('../log/runlog');
const { VirtualClock } = require('../sim/clock');
const { FakeWorker } = require('../sim/fake-worker');
const { PROFILES, SeededPlan } = require('../sim/faultplan');
const { World } = require('../sim/world');
const { computeMetrics } = require('./metrics');

const POLICIES = Object.freeze(['sequential', 'naive-parallel', 'naive-parallel-timeout', 'gated', 'gated-sequential']);
const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES));

// Frozen protocol parameters (docs/EVALUATION_PROTOCOL.md, "Fixed simulation parameters").
const PARAMS = Object.freeze({
  protocol_version: 1,
  retry_budget: 3,
  gated_deadline_multiple: 3,
  gated_backoff_ms_per_attempt: 20,
  gate_cost_ms_per_requirement: 5,
  tokens_per_worker_ms: 10,
  run_cap_multiple_of_critical_path: 30,
  concurrency_cap: 4,
});

/**
 * Run one (workload, profile, seed, policy) trial on the virtual clock and return its metrics.
 * For a fixed (workload, profile, seed) every policy faces identical per-attempt fates.
 */
async function runTrial({ workload, profile, seed, policy, plan: planOverride = null }) {
  const spec = workload.spec;
  const clock = new VirtualClock();
  const world = new World(spec.tasks);
  const plan = planOverride || new SeededPlan({ seed, profile, workload });
  const worker = new FakeWorker({ world, plan, clock });
  const stats = { violations: 0, peak: 0 };
  const observer = (event) => {
    if (event.type !== 'dispatch') return;
    if (!event.deps_ok) stats.violations++;
    if (event.inflight > stats.peak) stats.peak = event.inflight;
  };
  const runCapMs = PARAMS.run_cap_multiple_of_critical_path * workload.critical_path_ms;
  let handle;
  let log = null;
  if (policy === 'sequential') {
    handle = startSequential(spec, { worker, clock, observer, runCapMs });
  } else if (policy === 'naive-parallel' || policy === 'naive-parallel-timeout') {
    handle = startNaiveParallel(spec, { worker, clock, observer, runCapMs, deadlines: policy === 'naive-parallel-timeout' });
  } else if (policy === 'gated' || policy === 'gated-sequential') {
    log = new MemoryRunLog();
    const engine = new Engine(spec, {
      worker, clock, log, observer, gateCostMs: PARAMS.gate_cost_ms_per_requirement,
      concurrency: policy === 'gated-sequential' ? 1 : undefined,
    });
    handle = { promise: engine.run(), cancel: () => engine.cancel('BENCH_CANCEL') };
  } else {
    throw new Error(`unknown policy ${policy}`);
  }
  if (plan.cancelAt !== null) clock.setTimeout(() => handle.cancel(), plan.cancelAt);
  const report = await clock.run(handle.promise);
  const makespanMs = clock.now();
  world.closeAll(makespanMs);
  const auditViolations = log ? auditLog(spec, log.entries()).length : null;
  return computeMetrics({ workload, policy, report, world, stats, cancelAt: plan.cancelAt, makespanMs, auditViolations });
}

module.exports = Object.freeze({ PARAMS, POLICIES, PROFILE_NAMES, runTrial });
