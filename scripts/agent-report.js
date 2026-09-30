#!/usr/bin/env node
'use strict';

// Builds summary.json, REPORT.md and charts/*.svg from the files in a results directory (runs.jsonl, judgments.jsonl,
// plan.json, meta.json) - nothing is typed by hand.
//   node scripts/agent-report.js results/agent-claims/dev
// The output is a pure function of those files: running it twice gives byte-identical output.

const path = require('node:path');
const { buildReport } = require('../src/bench/agent-report-io');

//   node scripts/agent-report.js results/agent-claims/final --models a,b --out results/agent-claims/final/some-arm
// writes a report for those models only (a results directory that several arms fill would otherwise pool arms of different size).

try {
  const args = process.argv.slice(2);
  if (!args[0] || args[0].startsWith('--')) throw new Error('usage: agent-report.js <results-dir> [--models a,b --out <dir>]');
  const option = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    if (!args[i + 1]) throw new Error(`${name} needs a value`);
    return args[i + 1];
  };
  const dir = path.resolve(args[0]);
  const models = option('--models');
  const out = option('--out');
  if (models && !out) throw new Error('--models writes a different report, so it needs --out <dir>; the results directory keeps the full report');
  const outDir = out ? path.resolve(out) : dir;
  const { summary } = buildReport(dir, { models: models ? models.split(',') : null, outDir });
  process.stdout.write(`wrote summary.json, REPORT.md and charts/ in ${outDir} (${summary.n_runs} runs)\n`);
} catch (error) {
  process.stderr.write(`agent-report: ${error.message}\n`);
  process.exitCode = 1;
}
