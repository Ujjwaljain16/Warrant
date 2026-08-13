'use strict';

const { COMPARISONS } = require('./aggregate');
const { COMPARED_METRICS } = require('./metrics');

// Renders REPORT.md and SVG charts purely from summary.json + meta.json. No number appears here that is not
// read from those files; recreate with `node bin/warrant.js report <results-dir>`.

const POLICY_ORDER = ['sequential', 'naive-parallel', 'naive-parallel-timeout', 'gated', 'gated-sequential'];
const POLICY_COLOR = { sequential: '#8da0cb', 'naive-parallel': '#fc8d62', 'naive-parallel-timeout': '#e5c494', gated: '#2a7f62', 'gated-sequential': '#a6d854' };

function f(x, digits = 3) {
  if (x === null || x === undefined) return 'n/a';
  return Number.isInteger(x) && Math.abs(x) >= 1000 ? String(x) : x.toFixed(digits);
}

function withCI(summary, digits = 3) {
  if (!summary || summary.mean === null) return `n/a${summary && summary.n_valid === 0 ? ` (0/${summary.n} valid)` : ''}`;
  const ci = summary.ci95 ? ` [${f(summary.ci95.lo, digits)}, ${f(summary.ci95.hi, digits)}]` : '';
  const partial = summary.n_missing ? ` (n=${summary.n_valid}/${summary.n})` : '';
  return `${f(summary.mean, digits)}${ci}${partial}`;
}

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function sortCells(list) {
  return [...list].sort((x, y) => POLICY_ORDER.indexOf(x.policy) - POLICY_ORDER.indexOf(y.policy));
}

function headline(summary, profiles) {
  const rows = [];
  for (const profile of profiles) {
    for (const cell of sortCells(summary.pooled.filter((c) => c.profile === profile))) {
      const m = cell.metrics;
      rows.push([
        profile, cell.policy, withCI(m.correct_completion), withCI(m.false_success_rate), withCI(m.duplicate_effect_rate),
        f(m.dependency_order_violations.mean, 3), m.effects_after_cancel.mean === null ? 'n/a' : f(m.effects_after_cancel.mean, 2),
        `${f(cell.makespan_ms.p50, 0)} / ${f(cell.makespan_ms.p95, 0)}${cell.incomplete_runs ? ` (${cell.incomplete_runs} capped)` : ''}`,
        withCI(m.tokens_per_correct, 0), f(m.attempts.mean, 1),
      ]);
    }
  }
  return table(['profile', 'policy', 'correct completion', 'false-success rate', 'duplicate-effect rate', 'dep-order violations/run', 'effects after cancel/run', 'makespan P50 / P95 (sim ms)', 'tokens per correct task', 'attempts/run'], rows);
}

function verdictTable(summary, scope, pair, profiles) {
  const [a, b] = pair;
  const rows = [];
  for (const profile of profiles) {
    const c = summary.comparisons.find((x) => x.workload === scope && x.profile === profile && x.a === a && x.b === b);
    if (!c) continue;
    const cells = COMPARED_METRICS.map(([name]) => {
      const m = c.metrics[name];
      if (m.verdict === 'no-data') return 'n/a';
      const sign = m.mean_diff > 0 ? '+' : '';
      return `${m.verdict} (${sign}${f(m.mean_diff, Math.abs(m.mean_diff) >= 100 ? 0 : 3)})`;
    });
    rows.push([profile, ...cells]);
  }
  return table(['profile', ...COMPARED_METRICS.map(([n]) => n)], rows);
}

function worseList(summary) {
  const items = [];
  for (const c of summary.comparisons) {
    if (c.a !== 'gated' && !(c.a === 'gated-sequential')) continue;
    for (const [name] of COMPARED_METRICS) {
      const m = c.metrics[name];
      if (m.verdict === 'worse') items.push({ scope: c.workload, profile: c.profile, a: c.a, b: c.b, metric: name, diff: m.mean_diff, ci: m.ci95, pairs: m.n_pairs });
    }
  }
  return items;
}

// In the cancel profile, doing less after a cancel request is the goal, so lower completion/attempts/cost there is the
// intended behaviour rather than a defect. The row is still listed.
function cancelNote(w) {
  const relevant = ['correct_completion', 'attempts', 'tokens_per_correct'].includes(w.metric);
  return w.profile === 'cancel' && relevant ? 'expected: honouring cancellation does less work after the request' : '';
}

function chart(summary, profiles, metricName, title, yLabel) {
  const width = 980;
  const height = 380;
  const left = 56;
  const bottom = 90;
  const top = 36;
  const plotH = height - top - bottom;
  const plotW = width - left - 16;
  const groupW = plotW / profiles.length;
  const barW = Math.min(18, (groupW - 10) / POLICY_ORDER.length);
  const vals = [];
  for (const p of profiles) for (const pol of POLICY_ORDER) {
    const cell = summary.pooled.find((c) => c.profile === p && c.policy === pol);
    if (cell && cell.metrics[metricName].mean !== null) vals.push(cell.metrics[metricName].ci95 ? cell.metrics[metricName].ci95.hi : cell.metrics[metricName].mean);
  }
  const max = Math.max(...vals, 1e-9) * 1.1;
  const y = (v) => top + plotH - (v / max) * plotH;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="11">`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
    `<text x="${left}" y="18" font-size="14" font-weight="bold">${title}</text>`,
    `<text x="6" y="${top + plotH / 2}" transform="rotate(-90 6 ${top + plotH / 2})" text-anchor="middle">${yLabel}</text>`,
    `<line x1="${left}" y1="${top + plotH}" x2="${width - 16}" y2="${top + plotH}" stroke="#444"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#444"/>`];
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    parts.push(`<text x="${left - 4}" y="${y(v) + 3}" text-anchor="end">${f(v, max < 10 ? 2 : 0)}</text>`, `<line x1="${left}" y1="${y(v)}" x2="${width - 16}" y2="${y(v)}" stroke="#ddd"/>`);
  }
  profiles.forEach((p, gi) => {
    const gx = left + gi * groupW + 5;
    POLICY_ORDER.forEach((pol, bi) => {
      const cell = summary.pooled.find((c) => c.profile === p && c.policy === pol);
      const m = cell && cell.metrics[metricName];
      const x = gx + bi * barW;
      if (!m || m.mean === null) {
        parts.push(`<text x="${x + barW / 2}" y="${top + plotH - 4}" text-anchor="middle" font-size="9" fill="#999">n/a</text>`);
        return;
      }
      parts.push(`<rect x="${x}" y="${y(m.mean)}" width="${barW - 2}" height="${top + plotH - y(m.mean)}" fill="${POLICY_COLOR[pol]}"><title>${p} / ${pol}: ${f(m.mean, 3)}</title></rect>`);
      if (m.ci95) parts.push(`<line x1="${x + barW / 2 - 1}" y1="${y(m.ci95.lo)}" x2="${x + barW / 2 - 1}" y2="${y(m.ci95.hi)}" stroke="#222"/>`);
    });
    parts.push(`<text x="${gx + (POLICY_ORDER.length * barW) / 2}" y="${top + plotH + 14}" text-anchor="end" transform="rotate(-35 ${gx + (POLICY_ORDER.length * barW) / 2} ${top + plotH + 14})">${p}</text>`);
  });
  POLICY_ORDER.forEach((pol, i) => {
    parts.push(`<rect x="${left + i * 140}" y="${height - 14}" width="10" height="10" fill="${POLICY_COLOR[pol]}"/>`, `<text x="${left + i * 140 + 14}" y="${height - 5}">${pol}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

function renderReport(summary, meta) {
  const profiles = [...new Set(summary.pooled.map((c) => c.profile))];
  const workloads = [...new Set(summary.cells.map((c) => c.workload))];
  const totalRuns = summary.cells.reduce((s, c) => s + c.trials, 0);
  const gatedCells = summary.cells.filter((c) => c.policy.startsWith('gated'));
  const auditViolations = gatedCells.reduce((s, c) => s + c.audit_violations, 0);
  const auditedRuns = gatedCells.reduce((s, c) => s + c.audited_runs, 0);
  const capBreaches = Object.fromEntries(POLICY_ORDER.map((p) => [p, summary.cells.filter((c) => c.policy === p).reduce((s, c) => s + c.cap_exceeded_runs, 0)]));
  const capped = Object.fromEntries(POLICY_ORDER.map((p) => [p, summary.cells.filter((c) => c.policy === p).reduce((s, c) => s + c.incomplete_runs, 0)]));
  const worse = worseList(summary);
  const out = [];
  out.push(`# Benchmark report: ${meta.label}`, '');
  out.push('> **Simulated workers.** All latencies below are *simulated milliseconds* on a virtual clock and all faults are injected by a seeded model. These results say how the orchestration policies behave under the stated fault model; they are not measurements of any real model or provider.', '');
  out.push('## Provenance', '');
  out.push(table(['field', 'value'], [
    ['git commit', `\`${meta.git.commit}\`${meta.git.dirty ? ' (**working tree had uncommitted changes**)' : ''}`],
    ['protocol / dataset', `v${meta.protocol_version} / \`${meta.dataset_version}\``],
    ['seeds', `${meta.seeds.label}: ${meta.seeds.first}..${meta.seeds.last} (${meta.seeds.count} trials per cell)`],
    ['cells', `${workloads.length} workloads x ${profiles.length} profiles x ${POLICY_ORDER.length} policies`],
    ['total runs', String(totalRuns)],
    ['model / provider', 'none (deterministic simulation)'],
    ['parameters', Object.entries(meta.params).map(([k, v]) => `${k}=${v}`).join(', ')],
    ['environment', `node ${meta.environment.node}, ${meta.environment.platform}`],
    ['command', `\`${meta.command}\``],
    ['wall-clock to produce', `${f(meta.elapsed_seconds, 1)} s (real time; unrelated to simulated ms)`],
  ]), '');
  out.push('Raw per-run results: `raw.jsonl.gz`. Aggregates: `summary.json`. Regenerate this file with `node bin/warrant.js report <this directory>`.', '');

  out.push('## Self-checks', '');
  out.push(`- Log audit of every gated run (invariants I1-I8 checked independently of the engine): **${auditViolations} violations in ${auditedRuns} audited runs**.`);
  out.push(`- Runs in which a policy exceeded its concurrency cap: ${POLICY_ORDER.map((p) => `${p} ${capBreaches[p]}`).join(', ')}.`);
  out.push(`- Runs ended by the run-level cap (a hung attempt never resolved): ${POLICY_ORDER.map((p) => `${p} ${capped[p]}`).join(', ')}.`, '');

  out.push('## Headline results (pooled over all workloads)', '');
  out.push('**Reading the `cancel` profile:** work completed after a cancel request counts toward `correct completion`, so a policy that honours cancellation scores lower there by design. Judge that profile by `effects after cancel/run` (lower is better).', '');
  out.push('Means with 95% bootstrap CIs over trials. `n/a` = not measurable (e.g. no task succeeded, so a false-success *rate* is undefined); it is never shown as 0.', '');
  out.push(headline(summary, profiles), '');
  out.push('![correct completion](charts/correct_completion.svg)', '', '![false success](charts/false_success_rate.svg)', '', '![duplicate effects](charts/duplicate_effect_rate.svg)', '');

  out.push('## Paired comparisons (pooled)', '');
  out.push('Per-seed difference (first policy minus second) on identical fault plans; the verdict is "better" or "worse" only when the 95% CI of the mean difference excludes 0, otherwise "inconclusive". Direction is applied per metric (for example, lower false-success rate is better).', '');
  for (const pair of COMPARISONS) {
    out.push(`### ${pair[0]} vs ${pair[1]}`, '', verdictTable(summary, 'ALL', pair, profiles), '');
  }

  out.push('## Where the gated approach is worse', '');
  out.push('Generated automatically: every (scope, profile, comparison, metric) where the verdict for a gated policy is "worse". If this list is long, that is a finding, not noise.', '');
  if (worse.length === 0) out.push('_None._', '');
  else {
    out.push(table(['scope', 'profile', 'comparison', 'metric', 'mean difference', '95% CI', 'pairs', 'note'],
      worse.map((w) => [w.scope, w.profile, `${w.a} vs ${w.b}`, w.metric, f(w.diff, 3), `[${f(w.ci.lo, 3)}, ${f(w.ci.hi, 3)}]`, String(w.pairs), cancelNote(w)])), '');
  }

  out.push('## Per-workload results', '');
  for (const wl of workloads) {
    out.push(`### ${wl}`, '');
    const rows = [];
    for (const profile of profiles) {
      for (const cell of sortCells(summary.cells.filter((c) => c.workload === wl && c.profile === profile))) {
        rows.push([profile, cell.policy, withCI(cell.metrics.correct_completion), withCI(cell.metrics.false_success_rate), withCI(cell.metrics.duplicate_effect_rate), f(cell.makespan_ms.p50, 0), f(cell.makespan_ms.p95, 0)]);
      }
    }
    out.push(table(['profile', 'policy', 'correct completion', 'false-success rate', 'duplicate-effect rate', 'makespan P50', 'makespan P95'], rows), '');
  }

  out.push('## Method and limitations', '');
  out.push('See `docs/EVALUATION_PROTOCOL.md` (frozen before the final run) for policy definitions, fault profiles, metric definitions and threats to validity. In short: workers are simulated; fault rates are assumptions; baselines are intentionally simple; the benchmark requirements are complete by construction, so the gate here is as strong as it can be.', '');
  return out.join('\n');
}

function renderCharts(summary) {
  const profiles = [...new Set(summary.pooled.map((c) => c.profile))];
  return {
    'correct_completion.svg': chart(summary, profiles, 'correct_completion', 'Correct completion by fault profile (higher is better; bars = mean, whiskers = 95% CI)', 'fraction of tasks'),
    'false_success_rate.svg': chart(summary, profiles, 'false_success_rate', 'False-success rate by fault profile (lower is better)', 'wrongly-succeeded / succeeded'),
    'duplicate_effect_rate.svg': chart(summary, profiles, 'duplicate_effect_rate', 'Duplicate non-repeatable effects (lower is better)', 'fraction of non-repeatable tasks'),
  };
}

module.exports = Object.freeze({ renderCharts, renderReport });
