'use strict';

// Protocol v2, extension A: the partial-requirements experiment (docs/EVALUATION_PROTOCOL.md, "Version 2, extension A").
// It reuses the v1 workloads, fault plans, trial runner, metrics and aggregation unchanged; the only thing that varies is
// how complete the gate's requirements are (compileWorkload's `requirements` option). Nothing here is read by, or
// changes, the v1 benchmark path.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { aggregate } = require('./aggregate');
const { REPO_ROOT, gitInfo } = require('./cli');
const { COMPARED_METRICS } = require('./metrics');
const { PARAMS, runTrial } = require('./runner');
const { f, table, withCI } = require('./report');
const { pairedDifference, verdict } = require('./stats');
const { DATASET_VERSION, SHAPE_NAMES, buildWorkload } = require('./workloads');

const EXPERIMENT = 'partial-requirements';
const PARTIAL = Object.freeze({
  // New held-out seeds, disjoint from dev (0..99) and final (10000..10499).
  first: 20000,
  count: 500,
  profiles: Object.freeze(['false_claim', 'mixed']),
  requirement_sets: Object.freeze(['full', 'digest-only', 'shape-only']),
  policies: Object.freeze(['naive-parallel-timeout', 'gated']),
});

const SET_DESCRIPTION = Object.freeze({
  full: 'the v1 requirement set: a pinned sha256 of the output on every task, plus a JSON shape check on about half of them',
  'digest-only': 'only the pinned sha256 of the output (the v1 set without its shape checks)',
  'shape-only': 'only a JSON shape check (`inputs` object, `n` number, `task` string); no content is pinned',
});

// Metrics whose change between requirement sets is reported (gated, set vs `full`, paired by workload and seed).
const EFFECT_METRICS = Object.freeze(['false_success_rate', 'unsafe_final_status', 'correct_completion', 'makespan_ms', 'attempts']);
const HIGHER_IS_BETTER = Object.freeze(Object.fromEntries(COMPARED_METRICS));

// aggregate() groups by (workload, profile, policy); the requirement set is folded into the profile label.
const cellProfile = (profile, requirements) => `${profile}@${requirements}`;

function dirtyFiles(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((line) => line.slice(3)).sort();
  } catch (_error) {
    return null;
  }
}

function requirementCounts(workloadsBySet) {
  const out = {};
  for (const [set, workloads] of Object.entries(workloadsBySet)) {
    out[set] = {};
    for (const w of workloads) {
      const counts = {};
      for (const task of w.spec.tasks) for (const r of task.requirements) counts[r.kind] = (counts[r.kind] || 0) + 1;
      out[set][w.id] = counts;
    }
  }
  return out;
}

// For every (workload, profile, seed), the baseline never reads requirements, so it must behave identically under every
// requirement set. Checked from the raw records rather than assumed.
function baselineInvariance(records) {
  const seen = new Map();
  let mismatches = 0;
  let compared = 0;
  for (const r of records) {
    if (r.policy !== 'naive-parallel-timeout') continue;
    const { requirements, ...rest } = r;
    const k = `${r.workload}|${r.profile}|${r.seed}`;
    const body = JSON.stringify(rest);
    if (!seen.has(k)) { seen.set(k, body); continue; }
    compared++;
    if (seen.get(k) !== body) mismatches++;
  }
  return { compared, mismatches };
}

function requirementEffect(records, profiles, sets, workloadIds) {
  const out = [];
  const key = (r) => `${r.workload}|${r.profile}|${r.requirements}`;
  const groups = new Map();
  for (const r of records) {
    if (r.policy !== 'gated') continue;
    if (!groups.has(key(r))) groups.set(key(r), []);
    groups.get(key(r)).push(r);
  }
  for (const profile of profiles) {
    for (const set of sets.filter((s) => s !== 'full')) {
      const a = workloadIds.flatMap((w) => (groups.get(`${w}|${profile}|${set}`) || []).sort((x, y) => x.seed - y.seed));
      const b = workloadIds.flatMap((w) => (groups.get(`${w}|${profile}|full`) || []).sort((x, y) => x.seed - y.seed));
      if (a.length === 0 || a.length !== b.length) continue;
      for (let i = 0; i < a.length; i++) {
        if (a[i].seed !== b[i].seed || a[i].workload !== b[i].workload) throw new Error(`pair misalignment at ${profile}|${set}~full#${i}`);
      }
      const metrics = {};
      for (const name of EFFECT_METRICS) {
        const diff = pairedDifference(a.map((r, i) => [r[name], b[i][name]]), `effect|${profile}|${set}|${name}`);
        metrics[name] = { ...diff, higher_is_better: HIGHER_IS_BETTER[name], verdict: verdict(diff, HIGHER_IS_BETTER[name]) };
      }
      out.push({ profile, set, versus: 'full', metrics });
    }
  }
  return out;
}

/**
 * Run the experiment. `opts.first`/`opts.count` exist so tests can run a tiny slice on non-held-out seeds; the CLI
 * always uses PARTIAL.first/PARTIAL.count.
 */
async function runPartial({ outDir, first = PARTIAL.first, count = PARTIAL.count, workloadIds = SHAPE_NAMES, command = 'node bin/warrant.js bench --seeds partial-requirements', stderr = () => {} }) {
  // Provenance first: output directories usually live inside the repository (see runBench in cli.js).
  const git = { ...gitInfo(REPO_ROOT), dirty_files: dirtyFiles(REPO_ROOT) };
  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const workloadsBySet = Object.fromEntries(PARTIAL.requirement_sets.map((set) => [set, workloadIds.map((id) => buildWorkload(id, { requirements: set }))]));
  const lines = [];
  const total = workloadIds.length * PARTIAL.requirement_sets.length * PARTIAL.profiles.length * PARTIAL.policies.length * count;
  for (let w = 0; w < workloadIds.length; w++) {
    for (const requirements of PARTIAL.requirement_sets) {
      const workload = workloadsBySet[requirements][w];
      for (const profile of PARTIAL.profiles) {
        for (const policy of PARTIAL.policies) {
          for (let seed = first; seed < first + count; seed++) {
            const metrics = await runTrial({ workload, profile, seed, policy });
            lines.push(JSON.stringify({ workload: workload.id, profile, requirements, policy, seed, ...metrics }));
          }
        }
      }
    }
    stderr(`  ${workloadIds[w]}: ${lines.length}/${total} runs\n`);
  }

  const records = lines.map((l) => JSON.parse(l));
  fs.writeFileSync(path.join(outDir, 'raw.jsonl.gz'), zlib.gzipSync(Buffer.from(`${lines.join('\n')}\n`), { level: 9 }));
  const meta = {
    experiment: EXPERIMENT,
    label: 'partial-requirements experiment (protocol v2, extension A)',
    protocol_version: 2,
    base_protocol_version: PARAMS.protocol_version,
    dataset_version: DATASET_VERSION,
    git,
    seeds: { label: 'extension A held-out', first, last: first + count - 1, count },
    workloads: workloadIds,
    profiles: PARTIAL.profiles,
    requirement_sets: PARTIAL.requirement_sets,
    requirement_counts: requirementCounts(workloadsBySet),
    policies: PARTIAL.policies,
    params: PARAMS,
    environment: { node: process.version, platform: `${process.platform}/${process.arch}` },
    command,
    elapsed_seconds: (Date.now() - started) / 1000,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  const summary = {
    ...aggregate(records.map((r) => ({ ...r, profile: cellProfile(r.profile, r.requirements) }))),
    requirement_effect: requirementEffect(records, PARTIAL.profiles, PARTIAL.requirement_sets, workloadIds),
    baseline_invariance: baselineInvariance(records),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary)}\n`);
  writeReport(outDir, summary, meta);
  return { runs: records.length, out: outDir, elapsed_seconds: meta.elapsed_seconds };
}

// ----------------------------------------------------------------------------- report

function pooledCell(summary, profile, set, policy) {
  return summary.pooled.find((c) => c.profile === cellProfile(profile, set) && c.policy === policy);
}

function mainTable(summary, meta) {
  const rows = [];
  for (const profile of meta.profiles) {
    for (const set of meta.requirement_sets) {
      for (const policy of ['naive-parallel-timeout', 'gated']) {
        const c = pooledCell(summary, profile, set, policy);
        if (!c) continue;
        const m = c.metrics;
        rows.push([profile, set, policy, withCI(m.false_success_rate), withCI(m.unsafe_final_status), withCI(m.correct_completion), `${f(c.makespan_ms.p50, 0)} / ${f(c.makespan_ms.p95, 0)}`, f(m.attempts.mean, 1)]);
      }
    }
  }
  return table(['profile', 'requirements', 'policy', 'false-success rate', 'unsafe final status', 'correct completion', 'makespan P50 / P95 (sim ms)', 'attempts/run'], rows);
}

function versusBaselineTable(summary, meta) {
  const rows = [];
  for (const profile of meta.profiles) {
    for (const set of meta.requirement_sets) {
      const c = summary.comparisons.find((x) => x.workload === 'ALL' && x.profile === cellProfile(profile, set) && x.a === 'gated' && x.b === 'naive-parallel-timeout');
      if (!c) continue;
      rows.push([profile, set, ...EFFECT_METRICS.map((name) => {
        const m = c.metrics[name];
        if (m.verdict === 'no-data') return 'n/a';
        return `${m.verdict} (${m.mean_diff > 0 ? '+' : ''}${f(m.mean_diff, Math.abs(m.mean_diff) >= 100 ? 0 : 3)})`;
      })]);
    }
  }
  return table(['profile', 'requirements', ...EFFECT_METRICS], rows);
}

function effectTable(summary) {
  const rows = [];
  for (const e of summary.requirement_effect) {
    rows.push([e.profile, `${e.set} vs ${e.versus}`, ...EFFECT_METRICS.map((name) => {
      const m = e.metrics[name];
      if (m.verdict === 'no-data') return 'n/a';
      return `${m.verdict} (${m.mean_diff > 0 ? '+' : ''}${f(m.mean_diff, Math.abs(m.mean_diff) >= 100 ? 0 : 3)})`;
    })]);
  }
  return table(['profile', 'gated: requirement sets', ...EFFECT_METRICS], rows);
}

function perWorkloadTable(summary, meta) {
  const rows = [];
  for (const profile of meta.profiles) {
    for (const workload of meta.workloads) {
      for (const set of meta.requirement_sets) {
        const g = summary.cells.find((c) => c.workload === workload && c.profile === cellProfile(profile, set) && c.policy === 'gated');
        const b = summary.cells.find((c) => c.workload === workload && c.profile === cellProfile(profile, set) && c.policy === 'naive-parallel-timeout');
        if (!g || !b) continue;
        rows.push([profile, workload, set, withCI(g.metrics.false_success_rate), withCI(b.metrics.false_success_rate), withCI(g.metrics.correct_completion), withCI(b.metrics.correct_completion)]);
      }
    }
  }
  return table(['profile', 'workload', 'requirements', 'gated false-success', 'baseline false-success', 'gated correct completion', 'baseline correct completion'], rows);
}

function renderReport(summary, meta) {
  const gatedCells = summary.cells.filter((c) => c.policy === 'gated');
  const auditViolations = gatedCells.reduce((s, c) => s + c.audit_violations, 0);
  const auditedRuns = gatedCells.reduce((s, c) => s + c.audited_runs, 0);
  const capBreaches = summary.cells.reduce((s, c) => s + c.cap_exceeded_runs, 0);
  const capped = Object.fromEntries(meta.policies.map((p) => [p, summary.cells.filter((c) => c.policy === p).reduce((s, c) => s + c.incomplete_runs, 0)]));
  const totalRuns = summary.cells.reduce((s, c) => s + c.trials, 0);
  const out = [];
  out.push(`# Partial-requirements experiment: ${meta.label}`, '');
  out.push('> **Simulated workers.** Latencies are *simulated milliseconds* and all faults are injected by a seeded model. This is an extension to the frozen v1 protocol (`docs/EVALUATION_PROTOCOL.md`, "Version 2, extension A"); the v1 results in `results/final` are unchanged. It asks what happens to the gate\'s false-success guarantee when the requirements are **incomplete**.', '');
  out.push('## Provenance', '');
  const dirtyNote = meta.git.dirty
    ? ` (**working tree had uncommitted changes${meta.git.dirty_files && meta.git.dirty_files.length ? `: ${meta.git.dirty_files.map((x) => `\`${x}\``).join(', ')}` : ''}**; re-run from a clean commit for a clean-tree record)`
    : '';
  out.push(table(['field', 'value'], [
    ['git commit', `\`${meta.git.commit}\`${dirtyNote}`],
    ['protocol / dataset', `v${meta.protocol_version} extension A (base v${meta.base_protocol_version}) / \`${meta.dataset_version}\``],
    ['seeds', `${meta.seeds.label}: ${meta.seeds.first}..${meta.seeds.last} (${meta.seeds.count} trials per cell)${meta.seeds.first === PARTIAL.first && meta.seeds.count === PARTIAL.count ? '; disjoint from the development seeds 0..99 and the v1 held-out seeds 10000..10499; run once' : '; NOT the held-out seed range (test or development slice)'}`],
    ['cells', `${meta.workloads.length} workloads x ${meta.profiles.length} profiles (${meta.profiles.join(', ')}) x ${meta.requirement_sets.length} requirement sets x ${meta.policies.length} policies (${meta.policies.join(', ')})`],
    ['total runs', String(totalRuns)],
    ['model / provider', 'none (deterministic simulation)'],
    ['parameters', Object.entries(meta.params).map(([k, v]) => `${k}=${v}`).join(', ')],
    ['environment', `node ${meta.environment.node}, ${meta.environment.platform}`],
    ['command', `\`${meta.command}\``],
    ['wall-clock to produce', `${f(meta.elapsed_seconds, 1)} s (real time; unrelated to simulated ms)`],
  ]), '');
  out.push('Raw per-run results: `raw.jsonl.gz`. Aggregates: `summary.json`. Regenerate this file with `node bin/warrant.js report <this directory>`.', '');

  out.push('## Requirement sets', '');
  out.push(table(['set', 'what the gate checks', 'requirements per workload (kind: count)'],
    meta.requirement_sets.map((set) => [set, SET_DESCRIPTION[set], meta.workloads.map((w) => `${w}: ${Object.entries(meta.requirement_counts[set][w]).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('; ')])), '');
  out.push('The baseline policy (`naive-parallel-timeout`) never reads requirements, so its rows should be identical across sets; that is checked below rather than assumed.', '');

  out.push('## Self-checks', '');
  out.push(`- Log audit of every gated run (invariants I1-I8, which are relative to the requirements given, not to ground truth): **${auditViolations} violations in ${auditedRuns} audited runs**.`);
  const inv = summary.baseline_invariance;
  out.push(`- Baseline records identical across requirement sets: **${inv.compared - inv.mismatches} of ${inv.compared}** comparisons identical (${inv.mismatches} mismatches).`);
  out.push(`- Runs in which a policy exceeded its concurrency cap: ${capBreaches}.`);
  out.push(`- Runs ended by the run-level cap: ${meta.policies.map((p) => `${p} ${capped[p]}`).join(', ')}.`, '');

  out.push('## Results (pooled over all workloads)', '');
  out.push('Means with 95% bootstrap CIs over trials. False-success rate = tasks reported `succeeded` that are wrong, over tasks reported `succeeded` (`n/a` when nothing succeeded). Unsafe final status = wrong tasks that were reported `succeeded`, over all wrong tasks.', '');
  out.push(mainTable(summary, meta), '');

  out.push('## Gated vs the closest baseline, per requirement set', '');
  out.push('Per-seed difference (gated minus `naive-parallel-timeout`) on identical fault plans; "better"/"worse" only when the 95% CI excludes 0; lower is better for false-success, unsafe final status, makespan and attempts, higher for correct completion.', '');
  out.push(versusBaselineTable(summary, meta), '');

  out.push('## What incomplete requirements cost the gated policy', '');
  out.push('Gated with a weaker requirement set minus gated with the `full` set, paired by workload and seed. Same direction rules as above.', '');
  out.push(effectTable(summary), '');

  out.push('## Per-workload false-success and completion', '');
  out.push(perWorkloadTable(summary, meta), '');

  out.push('## Reading these results', '');
  out.push('- A requirement set is a statement of what the author knows to check. Wherever it is silent, the gate passes whatever the worker claims; a false claim that is well-formed, with the right types and wrong content, is invisible to a shape check.');
  out.push('- Because each task\'s correct output depends on its dependencies\' digests, a wrong output accepted upstream also makes dependants wrong; false successes therefore propagate through the graph.');
  out.push('- The requirement sets here are three points on one axis, chosen before the run; they are not a sample of real requirement quality. The workers are simulated and the fault rates are assumptions (protocol threats 1-3).');
  out.push('- Nothing was tuned after seeing these numbers; the sets, seeds and policies are as listed in the protocol extension.', '');
  return out.join('\n');
}

function writeReport(dir, summary, meta) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'REPORT.md'), `${renderReport(summary, meta)}\n`);
}

module.exports = Object.freeze({ PARTIAL, baselineInvariance, runPartial, writeReport });
