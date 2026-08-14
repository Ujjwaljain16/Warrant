#!/usr/bin/env node
'use strict';

// Orchestration overhead of the gated engine: wall-clock CPU time to push an N-task layered DAG (width 4)
// through dispatch -> envelope -> gate -> settle with an instant in-process worker, an in-memory hash-chained log
// and real timers. This is the engine's own cost, not the cost of any work. Compare with
// `scripts/profile-upstream-scheduler.js`, which times only upstream's state transitions on the same shape of graph.
//
//   node scripts/bench-overhead.js [passes]

const { Engine } = require('../src/engine/engine');
const { MemoryRunLog } = require('../src/log/runlog');
const { sha256Hex } = require('../src/core/verifiers');

const passes = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 7;
const SIZES = [20, 50, 100, 200, 400];
const WIDTH = 4;

function makeSpec(n) {
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push({
      id: `n${i}`, deps: i >= WIDTH ? [`n${i - WIDTH}`] : [], effect: 'pure', deadline_ms: 60_000, max_attempts: 1, outputs: ['out'],
      requirements: [{ id: 'exact', kind: 'artifact_sha256', artifact: 'out', sha256: sha256Hex('ok') }],
    });
  }
  return { spec_version: '1', run_id: 'run-overhead', max_concurrency: WIDTH, tasks };
}

const worker = { execute(info, ctx) { ctx.deliver({ attemptId: info.attemptId, claim: 'success', artifacts: { out: 'ok' } }); return Promise.resolve(); } };

async function once(spec) {
  const t0 = process.hrtime.bigint();
  const report = await new Engine(spec, { worker, log: new MemoryRunLog() }).run();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (report.status !== 'succeeded') throw new Error(`overhead run failed: ${report.status}`);
  return { ms, entries: report.log_entries };
}

(async () => {
  const rows = [];
  for (const n of SIZES) {
    const spec = makeSpec(n);
    await once(spec); // warm up
    const times = [];
    let entries = 0;
    for (let i = 0; i < passes; i++) { const r = await once(spec); times.push(r.ms); entries = r.entries; }
    times.sort((a, b) => a - b);
    rows.push({ n, entries, min: times[0], median: times[Math.floor(times.length / 2)] });
  }
  process.stdout.write(`${'tasks'.padStart(6)} ${'log entries'.padStart(12)} ${'min ms'.padStart(9)} ${'median ms'.padStart(10)} ${'median ms/task'.padStart(15)}\n`);
  for (const r of rows) process.stdout.write(`${String(r.n).padStart(6)} ${String(r.entries).padStart(12)} ${r.min.toFixed(1).padStart(9)} ${r.median.toFixed(1).padStart(10)} ${(r.median / r.n).toFixed(3).padStart(15)}\n`);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const exponent = Math.log(last.median / first.median) / Math.log(last.n / first.n);
  process.stdout.write(`\ntotal-time scaling exponent from ${first.n} to ${last.n} tasks: ${exponent.toFixed(2)} (1.00 = linear)\n`);
})().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
