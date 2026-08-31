#!/usr/bin/env node
'use strict';

// Crash-after-effect recovery with a real subprocess, end to end, using the CLI entry point.
//
//   node examples/receipt/demo.js
//
// 1. Run spec.json: the command appends one line to a ledger and writes its receipt. The run succeeds.
// 2. Simulate the orchestrator dying right after it dispatched the attempt (the log is cut back to that point; the
//    command had already run and left its receipt on disk).
// 3. Resume. The engine cannot know whether the charge happened, so it asks the worker, which reads the receipt and
//    answers "applied". The gate still checks the output. The ledger must still hold exactly one line.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../../src/cli/main');

async function cli(argv, cwd) {
  let out = '';
  let err = '';
  const code = await main(argv, { cwd, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
  return { code, out, err };
}

async function demo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-receipt-demo-'));
  const ledger = path.join(dir, 'ledger.txt');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'spec.json'), 'utf8'));
  spec.tasks[0].exec.argv = ['node', path.join(__dirname, 'charge.js'), ledger];
  const specFile = path.join(dir, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const logFile = path.join(dir, 'work', 'run-receipt', 'run.log');
  const lines = () => fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean);

  const first = await cli(['run', specFile, '--dir', 'work'], dir);
  console.log(`1. run:     exit ${first.code}, status ${JSON.parse(first.out).status}, ledger lines: ${lines().length}`);

  const entries = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  const cut = entries.findIndex((l) => l.includes('"attempt_started"'));
  fs.writeFileSync(logFile, `${entries.slice(0, cut + 1).join('\n')}\n`);
  console.log(`2. crash:   log cut back to entry ${cut + 1} of ${entries.length} (attempt dispatched, outcome never recorded)`);

  const resumed = await cli(['resume', specFile, '--log', logFile, '--dir', 'work'], dir);
  const report = JSON.parse(resumed.out);
  const reconcile = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'reconcile');
  console.log(`3. resume:  exit ${resumed.code}, status ${report.status}, charge attempts ${report.tasks.charge.attempts}, reconcile outcome "${reconcile && reconcile.data.outcome}", ledger lines: ${lines().length}`);

  const ok = first.code === 0 && resumed.code === 0 && report.status === 'succeeded' && reconcile.data.outcome === 'applied' && lines().length === 1;
  console.log(ok ? 'ok: the effect was applied exactly once and the result was recovered from the receipt' : 'UNEXPECTED RESULT');
  return ok ? 0 : 1;
}

demo().then((code) => { process.exitCode = code; });
