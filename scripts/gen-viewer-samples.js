#!/usr/bin/env node
'use strict';

// Regenerates viewer/samples/ from the real engine on the deterministic simulator (virtual clock, scripted faults),
// so the sample logs are genuine run logs rather than hand-written JSON.
//   node scripts/gen-viewer-samples.js          write the files
//   node scripts/gen-viewer-samples.js --check  exit 1 if the stored files differ from a fresh generation
//
// Samples (all share one run spec, so the spec-dependent checks I2/I3/I5 can run on any of them):
//   honest.jsonl          a clean pipeline run: one crash retried, one ambiguous effect reconciled, one duplicate ignored
//   lying-worker.jsonl    workers claim success with wrong output; the gate rejects, one task exhausts its attempts
//   tampered.jsonl        lying-worker with one gate verdict edited from fail to pass, hash left alone
//   forged-success.jsonl  lying-worker with a failed task rewritten as succeeded and every hash recomputed

const fs = require('node:fs');
const path = require('node:path');
const { Engine } = require('../src/engine/engine');
const { MemoryRunLog, buildEntry } = require('../src/log/runlog');
const { VirtualClock } = require('../src/sim/clock');
const { FakeWorker } = require('../src/sim/fake-worker');
const { ScriptedPlan } = require('../src/sim/faultplan');
const { World } = require('../src/sim/world');
const { compileWorkload } = require('../src/bench/workloads');

const OUT_DIR = path.join(__dirname, '..', 'viewer', 'samples');

const DRAFT = [
  { id: 'fetch', deps: [], effect: 'external-idempotent', nominal_ms: 120 },
  { id: 'parse', deps: ['fetch'], effect: 'pure', nominal_ms: 80 },
  { id: 'validate', deps: ['parse'], effect: 'pure', nominal_ms: 90 },
  { id: 'enrich', deps: ['parse'], effect: 'pure', nominal_ms: 150 },
  { id: 'publish', deps: ['validate', 'enrich'], effect: 'external-nonrepeatable', nominal_ms: 100 },
  { id: 'report', deps: ['publish'], effect: 'pure', nominal_ms: 60 },
];

async function simulate(script) {
  const workload = compileWorkload('nightly-etl', DRAFT, { maxConcurrency: 3 });
  const clock = new VirtualClock();
  const world = new World(workload.spec.tasks);
  const worker = new FakeWorker({ world, plan: new ScriptedPlan(script, { reconcileAvailable: true }), clock });
  const log = new MemoryRunLog();
  const engine = new Engine(workload.spec, { worker, clock, log, gateCostMs: 5 });
  await clock.run(engine.run());
  return { spec: workload.spec, entries: log.entries() };
}

const toJsonl = (entries) => entries.map((e) => `${JSON.stringify(e)}\n`).join('');

// Rebuilds a log from edited entries with every hash recomputed, as a forger who understands the format would.
function rehash(entries) {
  let prev = null;
  return entries.map((e, i) => {
    const fields = { data: e.data };
    if (e.task !== undefined) fields.task = e.task;
    if (e.attempt !== undefined) fields.attempt = e.attempt;
    const next = buildEntry(i + 1, prev, e.type, fields, e.t);
    prev = next.hash;
    return next;
  });
}

async function generate() {
  const honest = await simulate({
    'parse.1': { kind: 'crash_before' },
    'enrich.1': { duplicate: true },
    'publish.1': { kind: 'crash_after' },
  });
  const lying = await simulate({
    'parse.1': { kind: 'false_claim' },
    'enrich.1': { kind: 'false_claim' },
    'enrich.2': { kind: 'false_claim' },
    'enrich.3': { kind: 'false_claim' },
  });

  const lines = toJsonl(lying.entries).split('\n').filter(Boolean);
  const target = lying.entries.findIndex((e) => e.type === 'gate_verdict' && e.data.status === 'fail');
  if (target < 0) throw new Error('expected the lying sample to contain a rejected verdict');
  lines[target] = lines[target].replace('"status":"fail"', '"status":"pass"');
  const tampered = `${lines.join('\n')}\n`;

  const forgedEntries = lying.entries.map((e) => ({ ...e, data: { ...e.data } }));
  const settled = forgedEntries.findIndex((e) => e.type === 'task_settled' && e.task === 'enrich');
  const claimed = forgedEntries.findLast((e) => e.type === 'attempt_result' && e.task === 'enrich');
  forgedEntries[settled] = { ...forgedEntries[settled], attempt: 'enrich.3', data: { status: 'succeeded', code: 'VERIFIED', digest: claimed.data.digest } };
  const forged = toJsonl(rehash(forgedEntries));

  return {
    'honest.jsonl': toJsonl(honest.entries),
    'lying-worker.jsonl': toJsonl(lying.entries),
    'tampered.jsonl': tampered,
    'forged-success.jsonl': forged,
    'nightly-etl.spec.json': `${JSON.stringify(honest.spec, null, 2)}\n`,
  };
}

async function main() {
  const files = await generate();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([name, content]) => {
      const file = path.join(OUT_DIR, name);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content;
    });
    if (stale.length) {
      process.stderr.write(`viewer samples are stale: ${stale.map(([n]) => n).join(', ')} (run: node scripts/gen-viewer-samples.js)\n`);
      process.exit(1);
    }
    process.stdout.write('viewer samples are up to date\n');
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT_DIR, name), content);
  process.stdout.write(`wrote ${Object.keys(files).length} files to viewer/samples\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });

module.exports = { DRAFT, generate, rehash, simulate };
