#!/usr/bin/env node
'use strict';

// Builds summary.json, REPORT.md and charts/*.svg from the files in a results directory (runs.jsonl, judgments.jsonl,
// plan.json, meta.json) - nothing is typed by hand.
//   node scripts/agent-report.js results/agent-claims/dev
// The output is a pure function of those files: running it twice gives byte-identical output.

const path = require('node:path');
const { buildReport } = require('../src/bench/agent-report-io');

try {
  const dir = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('usage: agent-report.js <results-dir>');
  const { summary } = buildReport(dir);
  process.stdout.write(`wrote summary.json, REPORT.md and charts/ in ${dir} (${summary.n_runs} runs)\n`);
} catch (error) {
  process.stderr.write(`agent-report: ${error.message}\n`);
  process.exitCode = 1;
}
