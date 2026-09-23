'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listSplit, loadTask } = require('../agent');
const { renderCharts, renderReport } = require('./agent-report');
const { summarize } = require('./agent-summary');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Reads a results directory, writes summary.json, REPORT.md and charts/*.svg next to the data, and returns them. */
function buildReport(dir, { taskDirs } = {}) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const plan = readJson(path.join(dir, 'plan.json'));
  const stage = (meta && meta.stage) || (plan && plan.stage);
  if (!stage) throw new Error(`${dir} has no meta.json or plan.json; is it a results directory?`);
  const dirs = taskDirs || listSplit(stage);
  const taskMeta = new Map(dirs.map((d) => { const t = loadTask(d); return [t.id, t.meta]; }));
  const summary = summarize({ stage, runs: readJsonl(path.join(dir, 'runs.jsonl')), judgments: readJsonl(path.join(dir, 'judgments.jsonl')), taskMeta, plan });
  const reportMeta = meta ? { git: meta.git, protocol_commit: meta.protocol && meta.protocol.commit } : null;
  fs.writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  fs.writeFileSync(path.join(dir, 'REPORT.md'), renderReport(summary, reportMeta));
  fs.mkdirSync(path.join(dir, 'charts'), { recursive: true });
  for (const [name, svg] of Object.entries(renderCharts(summary))) fs.writeFileSync(path.join(dir, 'charts', name), `${svg}\n`);
  return { summary };
}

module.exports = Object.freeze({ buildReport });
