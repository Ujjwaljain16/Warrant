#!/usr/bin/env node
'use strict';
// Documentation consistency: relative links resolve, headline numbers quoted in the docs equal the generated reports,
// task counts equal the task directories, and phrases known to contradict the code are absent.
// Dependency-free. Exit 1 with a list of problems.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const DOCS = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md',
  ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

// 1. Relative links resolve.
for (const rel of DOCS) {
  const text = read(rel).replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const file = decodeURIComponent(target.split('#')[0]);
    if (file === '') continue;
    if (!fs.existsSync(path.resolve(ROOT, path.dirname(rel), file))) problems.push(`${rel}: broken link (${target})`);
  }
}

// 2. Numbers quoted in the docs equal the generated reports.
const pct = (x) => `${(x * 100).toFixed(1)}%`;
function mustContain(rel, needle, why) {
  if (!read(rel).includes(needle)) problems.push(`${rel}: expected "${needle}" (${why})`);
}
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A count and a rate stated near each other on one line, in either order.
function mustPair(rel, count, rate, why) {
  const c = `\\b${count}\\b`;
  const r = escapeRe(rate);
  const re = new RegExp(`${c}[^\\n]{0,30}${r}|${r}[^\\n]{0,30}${c}`);
  if (!re.test(read(rel))) problems.push(`${rel}: expected ${count} and ${rate} stated together (${why})`);
}

const sim = read('results/final/REPORT.md');
function simCell(profile, policy) {
  const line = sim.split('\n').find((l) => l.startsWith(`| ${profile} | ${policy} |`));
  if (!line) { problems.push(`results/final/REPORT.md: no row for ${profile}/${policy}`); return null; }
  return line.split('|').slice(1, -1).map((s) => s.trim());
}
// columns: profile, policy, correct, false-success, duplicate-effect, ...
const lead = (cell) => (cell === null ? null : Number.parseFloat(cell));
const simPins = [
  ['false_claim', 3, 'workers falsely claim success: baseline false-success'],
  ['mixed', 4, 'mixed faults: baseline duplicate non-repeatable effects'],
  ['duplicate_delivery', 3, 'duplicate delivery: baseline false-success'],
  ['crash', 4, 'crash: baseline duplicate non-repeatable effects'],
];
for (const [profile, col, why] of simPins) {
  const base = simCell(profile, 'naive-parallel-timeout');
  const gated = simCell(profile, 'gated');
  if (base === null || gated === null) continue;
  mustContain('README.md', pct(lead(base[col])), `${why}, from results/final/REPORT.md`);
  if (lead(gated[col]) !== 0) problems.push(`results/final/REPORT.md: ${profile} gated column ${col} is not 0, but the README says 0%`);
}

const agent = read('results/agent-claims/final/REPORT.md');
const allModels = agent.slice(agent.indexOf('**all models**'));
function strategyRow(name) {
  const line = allModels.split('\n').find((l) => l.startsWith(`| ${name} |`));
  if (!line) { problems.push(`results/agent-claims/final/REPORT.md: no "all models" row for ${name}`); return null; }
  const m = line.split('|')[2].trim().match(/^([\d.]+%) \[([\d.]+%), ([\d.]+%)\] \((\d+)\/(\d+)\)/);
  return m ? { rate: m[1], lo: m[2], hi: m[3], n: m[4], d: m[5] } : null;
}
const trust = strategyRow('trust the claim');
const visible = strategyRow("agent's own visible tests");
const gate = strategyRow('warrant hidden-test gate');
const claims = agent.split('\n').find((l) => l.startsWith('| all models | 180 |'));
if (!trust || !visible || !gate || !claims) {
  problems.push('results/agent-claims/final/REPORT.md: could not parse the all-models rows');
} else {
  const cols = claims.split('|').map((s) => s.trim());
  const wrong = cols[5].match(/^([\d.]+%) \[([\d.]+%), ([\d.]+%)\] \((\d+)\/(\d+)\)/);
  for (const doc of ['README.md', 'docs/AGENT_RESULTS.md']) {
    if (!new RegExp(`${trust.n} of ${trust.d}|all ${trust.d}`).test(read(doc))) problems.push(`${doc}: expected "${trust.n} of ${trust.d}" or "all ${trust.d}" (trust-the-claim accepted)`);
    mustPair(doc, visible.n, visible.rate, 'visible tests accepted');
    mustPair(doc, gate.n, gate.rate, 'gate accepted');
    mustContain(doc, trust.d, 'wrong claims');
    mustContain(doc, `${gate.lo} to ${gate.hi}`, 'gate interval');
    if (wrong) {
      mustContain(doc, wrong[1], 'wrong-claim rate');
      mustContain(doc, `${wrong[2]} to ${wrong[3]}`, 'wrong-claim interval');
    }
  }
  if (wrong) {
    mustContain('README.md', `${wrong[4]} of those claims`, 'wrong claims given claims of done');
    mustContain('README.md', `The agents claimed "done" ${cols[3]} times`, 'claims of done');
  }
}

// 3. Task counts equal the task directories.
const taskDirs = (rel) => (exists(rel) ? fs.readdirSync(path.join(ROOT, rel)).filter((d) => exists(`${rel}/${d}/meta.json`)) : []);
const nDev = taskDirs('bench/agent-claims/tasks/dev').length;
const nFinal = taskDirs('bench/agent-claims/tasks/final').length;
const nToy = taskDirs('bench/agent-claims/toy').length;
const nAll = nDev + nFinal + nToy;
mustContain('README.md', `${nAll} tasks`, `${nDev} dev + ${nFinal} final + ${nToy} toy task directories`);
mustContain('README.md', `${nFinal} held-out tasks`, 'held-out task directories');
mustContain('docs/OVERVIEW.md', `${nFinal} held-out tasks`, 'held-out task directories');
mustContain('docs/FINAL_AUDIT.md', `${nAll} original tasks`, 'task directories');

// 4. Phrases that contradict the code or the history.
const stale = [
  /no network access, no environment variables required/i,
  /\b40 original (javascript )?tasks\b/i,
  /no model-provider abstraction/i,
  /never run on github-hosted/i,
  /no measurement reported/i,
  /commit (dates|timestamps) (are|were) (genuine|unaltered|real)/i,
];
for (const rel of DOCS) {
  const text = read(rel);
  for (const re of stale) if (re.test(text)) problems.push(`${rel}: stale or contradictory phrase /${re.source}/`);
}

if (problems.length > 0) {
  console.error(`check-docs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-docs ok: ${DOCS.length} documents, links resolve, headline numbers match the reports, ${nAll} task directories (${nDev} dev, ${nFinal} final, ${nToy} toy)`);
