#!/usr/bin/env node
'use strict';

// Validates every agent task under bench/agent-claims (tasks/dev, tasks/final, toy) or the directories given:
//   node scripts/agent-task-check.js [task-dir ...] [--run] [--split dev|final|toy] [--jobs N] [--write-manifest]
// Static checks: required files, meta.json schema, outputs present in repo/ and reference/, hidden suites not shadowed by
// or mentioned in the visible material, task ids unique across all splits, no secret-shaped strings in any task file.
// With --run (needs Docker) it also proves, inside the sandbox, for each task, running every suite twice:
//   - the gate tests AND the audit tests FAIL on the starting repo,
//   - both PASS on the reference solution, and so do the visible tests,
//   - the visible tests on the starting repo are in the state meta.visible_on_start documents,
//   - for tasks with a naive/ solution: the visible tests pass on it while the gate fails,
//   - every suite gives the identical result both times (deterministic),
//   - the reference solution runs exactly the tests pinned in bench/agent-claims/gate-manifest.json (--write-manifest regenerates the pins
//     from the reference run; use it only for a deliberate change of a hidden suite, and review the diff).
// Exits non-zero on any problem.

const path = require('node:path');
const fs = require('node:fs');
const { GATE_MANIFEST, loadManifest, manifestKey } = require('../src/agent/gate');
const { runTaskProperties } = require('../src/agent/properties');
const { scanTreeForSecrets } = require('../src/agent/secretscan');
const { SPLITS, listSplit, loadTask, validateTaskDir } = require('../src/agent/task');

function parseArgs(argv) {
  const out = { run: false, split: null, jobs: 2, dirs: [], writeManifest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') out.run = true;
    else if (argv[i] === '--write-manifest') { out.writeManifest = true; out.run = true; }
    else if (argv[i] === '--split') out.split = argv[++i];
    else if (argv[i] === '--jobs') out.jobs = Number(argv[++i]);
    else if (argv[i].startsWith('--')) throw new Error(`unknown option ${argv[i]}`);
    else out.dirs.push(path.resolve(argv[i]));
  }
  if (out.split && !SPLITS.includes(out.split)) throw new Error(`--split must be one of ${SPLITS.join(', ')}`);
  if (!Number.isInteger(out.jobs) || out.jobs < 1 || out.jobs > 8) throw new Error('--jobs must be 1..8');
  return out;
}

async function mapPool(items, jobs, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

// Pins from the reference runs: per task and test file, the number and names of the top-level tests.
function writeManifest(collected, complete) {
  const old = loadManifest();
  const tasks = complete ? {} : { ...((old && old.tasks) || {}) };
  for (const [key, collect] of collected) {
    const entry = {};
    for (const result of [collect.gate, collect.audit]) {
      for (const f of (result && result.files) || []) entry[f.testFile] = { tests: f.tests, names: f.names };
    }
    tasks[key] = entry;
  }
  const sorted = Object.fromEntries(Object.keys(tasks).sort().map((k) => [k, tasks[k]]));
  fs.writeFileSync(GATE_MANIFEST, `${JSON.stringify({ version: 1, tasks: sorted }, null, 1)}
`);
  process.stdout.write(`wrote ${GATE_MANIFEST} (${Object.keys(sorted).length} tasks)
`);
}

async function main(argv) {
  const args = parseArgs(argv);
  const everything = SPLITS.flatMap((s) => listSplit(s));
  const targets = args.dirs.length ? args.dirs : (args.split ? listSplit(args.split) : everything);
  const problems = [];
  const label = (dir) => `${path.basename(path.dirname(dir))}/${path.basename(dir)}`;

  // ids must be unique across every split, not just within the selected one
  const seen = new Map();
  for (const dir of everything) {
    const id = path.basename(dir);
    if (seen.has(id)) problems.push(`task id "${id}" is used twice: ${label(seen.get(id))} and ${label(dir)}`);
    seen.set(id, dir);
  }
  for (const dir of targets) {
    for (const p of validateTaskDir(dir)) problems.push(`${label(dir)}: ${p}`);
    for (const p of scanTreeForSecrets(dir)) problems.push(`${label(dir)}: secret-shaped content: ${p}`);
  }
  if (args.run && problems.length === 0) {
    const collected = new Map();
    const manifest = loadManifest();
    const lists = await mapPool(targets, args.jobs, async (dir) => {
      const task = loadTask(dir);
      const collect = {};
      const found = await runTaskProperties(task.dir, args.writeManifest ? { collect, expected: null } : { collect });
      if (!args.writeManifest && !(manifest && manifest.tasks && manifest.tasks[manifestKey(task)])) found.push(`gate-manifest.json has no entry for ${manifestKey(task)} (node scripts/agent-task-check.js --write-manifest)`);
      collected.set(manifestKey(task), collect);
      process.stderr.write(`${found.length ? 'FAIL' : 'ok  '} ${label(dir)}\n`);
      return found.map((p) => `${label(dir)}: ${p}`);
    });
    for (const list of lists) problems.push(...list);
    if (args.writeManifest && problems.length === 0) writeManifest(collected, targets.length === everything.length);
  }
  if (problems.length) {
    process.stderr.write(`${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 1;
  }
  const counts = SPLITS.map((s) => `${s}=${targets.filter((d) => path.basename(path.dirname(d)) === s || (s === 'toy' && path.basename(path.dirname(d)) === 'toy')).length}`).join(' ');
  process.stdout.write(`agent tasks ok: ${targets.length} task(s) (${counts})${args.run ? ', properties proven in the sandbox (every suite run twice)' : ' (static checks only; use --run for sandbox properties)'}\n`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`agent-task-check failed: ${error.message}\n`);
  process.exitCode = 1;
});
