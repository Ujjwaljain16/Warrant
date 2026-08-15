'use strict';

const { Engine } = require('../src/engine/engine');
const { MemoryRunLog } = require('../src/log/runlog');
const { auditLog } = require('../src/engine/replay');
const { VirtualClock } = require('../src/sim/clock');
const { FakeWorker } = require('../src/sim/fake-worker');
const { ScriptedPlan } = require('../src/sim/faultplan');
const { World } = require('../src/sim/world');
const { compileWorkload } = require('../src/bench/workloads');
const { assertRunSpec } = require('../src/core/spec');

// Draft task: 100 simulated ms nominal, so the gated deadline is 300.
const d = (id, deps = [], effect = 'pure') => ({ id, deps, effect, nominal_ms: 100 });

async function simulate(draft, script = {}, options = {}) {
  const { reconcile = true, cancelAt = null, maxConcurrency = 4, engineOpts = {}, workerFactory = null, specTransform = null } = options;
  const compiled = compileWorkload('mini', draft, { maxConcurrency });
  // Lets a test add requirements that compileWorkload does not generate (for example host-side predicates).
  const workload = specTransform ? { ...compiled, spec: assertRunSpec(specTransform(JSON.parse(JSON.stringify(compiled.spec)))) } : compiled;
  const clock = new VirtualClock();
  const world = new World(workload.spec.tasks);
  const plan = new ScriptedPlan(script, { reconcileAvailable: reconcile });
  const worker = workerFactory ? workerFactory({ world, clock, plan, workload }) : new FakeWorker({ world, plan, clock });
  const log = new MemoryRunLog();
  const events = [];
  const engine = new Engine(workload.spec, { worker, clock, log, gateCostMs: 5, observer: (e) => events.push(e), ...engineOpts });
  if (cancelAt !== null) clock.setTimeout(() => engine.cancel('TEST_CANCEL'), cancelAt);
  const report = await clock.run(engine.run());
  world.closeAll(clock.now());
  const entries = log.entries();
  return { report, world, log, entries, events, clock, workload, engine, violations: auditLog(workload.spec, entries) };
}

const types = (entries, type, task) => entries.filter((e) => e.type === type && (task === undefined || e.task === task));

module.exports = { d, simulate, types };
