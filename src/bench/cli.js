'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { aggregate } = require('./aggregate');
const { PARAMS, POLICIES, PROFILE_NAMES, runTrial } = require('./runner');
const { renderCharts, renderReport } = require('./report');
const { DATASET_VERSION, SHAPE_NAMES, buildWorkload } = require('./workloads');

// Seed ranges are fixed by docs/EVALUATION_PROTOCOL.md: development seeds are for debugging, final seeds are
// run once after the protocol is committed.
const SEED_SETS = Object.freeze({ dev: { first: 0, count: 100 }, final: { first: 10000, count: 500 } });

function git(cwd, ...args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_error) { return null; }
}

function gitInfo(cwd) {
  const commit = git(cwd, 'rev-parse', 'HEAD');
  const status = git(cwd, 'status', '--porcelain');
  return { commit: commit || 'unknown (not a git checkout)', dirty: status === null ? null : status.length > 0 };
}

function pick(all, csv, label) {
  if (!csv) return all;
  const wanted = csv.split(',');
  for (const w of wanted) if (!all.includes(w)) throw new Error(`unknown ${label}: ${w}`);
  return wanted;
}

async function runBench(flags, io) {
  const seedSet = flags['--seeds'] || 'dev';
  if (!Object.hasOwn(SEED_SETS, seedSet)) throw new Error('--seeds must be "dev" or "final"');
  const { first, count } = SEED_SETS[seedSet];
  const workloadIds = pick(SHAPE_NAMES, flags['--workloads'], 'workload');
  const profiles = pick(PROFILE_NAMES, flags['--profiles'], 'profile');
  const outDir = path.resolve(io.cwd, flags['--out'] || path.join('results', seedSet));
  fs.mkdirSync(outDir, { recursive: true });

  const started = Date.now();
  const workloads = workloadIds.map((id) => buildWorkload(id));
  const lines = [];
  let done = 0;
  const total = workloads.length * profiles.length * POLICIES.length * count;
  for (const workload of workloads) {
    for (const profile of profiles) {
      for (const policy of POLICIES) {
        for (let seed = first; seed < first + count; seed++) {
          const metrics = await runTrial({ workload, profile, seed, policy });
          lines.push(JSON.stringify({ workload: workload.id, profile, policy, seed, ...metrics }));
          done++;
        }
      }
    }
    io.stderr(`  ${workload.id}: ${done}/${total} runs\n`);
  }

  const raw = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'raw.jsonl.gz'), zlib.gzipSync(Buffer.from(raw), { level: 9 }));
  const records = lines.map((l) => JSON.parse(l));
  const meta = {
    label: `${seedSet} seeds`,
    protocol_version: PARAMS.protocol_version,
    dataset_version: DATASET_VERSION,
    git: gitInfo(path.resolve(__dirname, '..', '..')),
    seeds: { label: seedSet, first, last: first + count - 1, count },
    workloads: workloadIds,
    profiles,
    policies: POLICIES,
    params: PARAMS,
    environment: { node: process.version, platform: `${process.platform}/${process.arch}` },
    command: `node bin/warrant.js bench --seeds ${seedSet}${flags['--workloads'] ? ` --workloads ${flags['--workloads']}` : ''}${flags['--profiles'] ? ` --profiles ${flags['--profiles']}` : ''}${flags['--out'] ? ` --out ${flags['--out']}` : ''}`,
    elapsed_seconds: (Date.now() - started) / 1000,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const summary = aggregate(records);
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary)}\n`);
  writeReport(outDir, summary, meta);
  io.stdout(`${JSON.stringify({ runs: done, out: outDir, elapsed_seconds: meta.elapsed_seconds }, null, 2)}\n`);
  return 0;
}

function writeReport(dir, summary, meta) {
  fs.mkdirSync(path.join(dir, 'charts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'REPORT.md'), `${renderReport(summary, meta)}\n`);
  for (const [name, svg] of Object.entries(renderCharts(summary))) fs.writeFileSync(path.join(dir, 'charts', name), `${svg}\n`);
}

function runReport(rest, io) {
  if (rest.length !== 1) throw new Error('report takes exactly one results directory');
  const dir = path.resolve(io.cwd, rest[0]);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  writeReport(dir, summary, meta);
  io.stdout(`wrote ${path.join(dir, 'REPORT.md')}\n`);
  return 0;
}

async function run(command, rest, flags, io) {
  if (command === 'bench') return runBench(flags, io);
  return runReport(rest, io);
}

module.exports = Object.freeze({ SEED_SETS, run, runBench, writeReport });
