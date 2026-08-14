#!/usr/bin/env node
'use strict';

// CPU-profiles the benchmark trial runner and prints the top self-time functions, so optimization starts from
// measurement. Usage:
//   node scripts/profile-bench.js [trials-per-policy]          # time + profile, prints a table
// The same harness is used for before/after numbers: `node scripts/profile-bench.js 200 --time-only`.

const fs = require('node:fs');
const inspector = require('node:inspector');
const os = require('node:os');
const path = require('node:path');
const { buildWorkload } = require('../src/bench/workloads');
const { POLICIES, runTrial } = require('../src/bench/runner');

const trials = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 100;
const timeOnly = process.argv.includes('--time-only');
const WORKLOADS = ['diamond-lattice-16', 'random-dag-32'];
const PROFILES = ['none', 'mixed', 'crash'];

async function workload() {
  let n = 0;
  for (const id of WORKLOADS) {
    const wl = buildWorkload(id);
    for (const profile of PROFILES) for (const policy of POLICIES) for (let seed = 0; seed < trials; seed++) { await runTrial({ workload: wl, profile, seed, policy }); n++; }
  }
  return n;
}

function post(session, method, params) {
  return new Promise((resolve, reject) => session.post(method, params, (e, r) => (e ? reject(e) : resolve(r))));
}

(async () => {
  await workload(); // warm up the JIT with a full pass so both timings are steady-state
  if (timeOnly) {
    const runs = [];
    for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); const n = await workload(); runs.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6, n }); }
    const per = runs.map((r) => r.ms / r.n);
    per.sort((a, b) => a - b);
    process.stdout.write(`trials per pass: ${runs[0].n}; ms/trial over 5 passes: min ${per[0].toFixed(3)} median ${per[2].toFixed(3)} max ${per[4].toFixed(3)}\n`);
    return;
  }
  const session = new inspector.Session();
  session.connect();
  await post(session, 'Profiler.enable');
  await post(session, 'Profiler.start');
  const t0 = process.hrtime.bigint();
  const n = await workload();
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
  const { profile } = await post(session, 'Profiler.stop');
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const cf = node.callFrame;
    const file = cf.url ? path.relative(path.resolve(__dirname, '..'), cf.url.replace(/^file:\/\/\//, '')).split(path.sep).join('/') : '(native)';
    const key = `${cf.functionName || '(anonymous)'}  ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + dt[i]);
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  process.stdout.write(`${n} trials in ${elapsed.toFixed(0)} ms (${(elapsed / n).toFixed(3)} ms/trial), profile total ${(total / 1000).toFixed(0)} ms\n\n`);
  process.stdout.write(`${'self %'.padStart(7)}  ${'self ms'.padStart(8)}  function\n`);
  for (const [key, us] of rows) process.stdout.write(`${((100 * us) / total).toFixed(1).padStart(6)}%  ${(us / 1000).toFixed(1).padStart(8)}  ${key}\n`);
  fs.writeFileSync(path.join(os.tmpdir(), 'warrant-bench.cpuprofile'), JSON.stringify(profile));
})().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
