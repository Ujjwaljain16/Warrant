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

/**
 * Reads a results directory, writes summary.json, REPORT.md and charts/*.svg next to the data (or into `outDir`), and returns them.
 * `models` restricts the report to those models: runs, judgments and the plan are filtered before anything is computed, so a pooled
 * row covers exactly the chosen models (a results directory that several arms fill would otherwise pool arms of different size).
 */
function buildReport(dir, { taskDirs, models = null, outDir = dir } = {}) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const plan = readJson(path.join(dir, 'plan.json'));
  const stage = (meta && meta.stage) || (plan && plan.stage);
  if (!stage) throw new Error(`${dir} has no meta.json or plan.json; is it a results directory?`);
  const dirs = taskDirs || listSplit(stage);
  const taskMeta = new Map(dirs.map((d) => { const t = loadTask(d); return [t.id, t.meta]; }));
  const wanted = models ? new Set(models) : null;
  const keep = (key) => !wanted || [...wanted].some((m) => key.startsWith(`${stage}/${m}/`));
  const runs = readJsonl(path.join(dir, 'runs.jsonl')).filter((r) => !wanted || wanted.has(r.model));
  const judgments = readJsonl(path.join(dir, 'judgments.jsonl')).filter((j) => keep(j.run));
  const scopedPlan = plan && wanted ? { ...plan, models: plan.models.filter((m) => wanted.has(m)), keys: plan.keys.filter(keep) } : plan;
  const summary = summarize({ stage, runs, judgments, taskMeta, plan: scopedPlan });
  const reportMeta = meta ? { git: meta.git, protocol_commit: meta.protocol && meta.protocol.commit } : null;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), renderReport(summary, reportMeta));
  fs.mkdirSync(path.join(outDir, 'charts'), { recursive: true });
  for (const [name, svg] of Object.entries(renderCharts(summary))) fs.writeFileSync(path.join(outDir, 'charts', name), `${svg}\n`);
  return { summary };
}

module.exports = Object.freeze({ buildReport });
