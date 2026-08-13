'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { aggregate } = require('../src/bench/aggregate');
const { COMPARED_METRICS } = require('../src/bench/metrics');
const { PARAMS, POLICIES, runTrial } = require('../src/bench/runner');
const { renderCharts, renderReport } = require('../src/bench/report');
const { bootstrapMeanCI, latencySummary, mean, pairedDifference, percentile, summarize, verdict } = require('../src/bench/stats');
const { allWorkloads, buildWorkload } = require('../src/bench/workloads');
const { build: buildDataset } = require('../scripts/gen-workloads');
const { SeededPlan, PROFILES } = require('../src/sim/faultplan');
const { unit } = require('../src/sim/rng');
const { main } = require('../src/cli/main');

test('dataset: the stored workloads-v1.json equals regeneration from the generator (no drift)', () => {
  const stored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bench', 'data', 'workloads-v1.json'), 'utf8'));
  assert.deepEqual(stored, JSON.parse(JSON.stringify(buildDataset())));
});

test('dataset: ground truth is consistent, so a fault-free gated run completes every workload correctly', async () => {
  for (const workload of allWorkloads()) {
    assert.ok(workload.critical_path_ms > 0);
    assert.ok(workload.spec.tasks.some((t) => t.id === workload.fail_task));
    for (const policy of POLICIES) {
      const m = await runTrial({ workload, profile: 'none', seed: 1, policy });
      assert.equal(m.correct_completion, 1, `${workload.id}/${policy}`);
      assert.equal(m.false_success_rate, 0);
    }
  }
});

test('rng: unit() is deterministic, in [0,1), and close to uniform', () => {
  assert.equal(unit('k'), unit('k'));
  assert.notEqual(unit('k1'), unit('k2'));
  const buckets = new Array(10).fill(0);
  const n = 50_000;
  let sum = 0;
  for (let i = 0; i < n; i++) { const u = unit(`seed|task${i % 97}|${i}|fate`); assert.ok(u >= 0 && u < 1); buckets[Math.floor(u * 10)]++; sum += u; }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01);
  const chi = buckets.reduce((s, c) => s + ((c - n / 10) ** 2) / (n / 10), 0);
  assert.ok(chi < 27.9, `chi-square ${chi.toFixed(1)} exceeds the 0.001 critical value for 9 dof`);
});

test('fault plan: a fate is a pure function of (seed, task, attempt) and matches the protocol rates', () => {
  const workload = buildWorkload('chain-8');
  const plan = new SeededPlan({ seed: 5, profile: 'mixed', workload });
  const again = new SeededPlan({ seed: 5, profile: 'mixed', workload });
  for (let a = 1; a <= 3; a++) assert.deepEqual(plan.fate('t3', a), again.fate('t3', a));
  assert.notDeepEqual(
    Array.from({ length: 50 }, (_, s) => new SeededPlan({ seed: s, profile: 'mixed', workload }).fate('t3', 1).kind),
    Array.from({ length: 50 }, () => 'normal'),
  );
  const counts = {};
  const trials = 40_000;
  for (let s = 0; s < trials; s++) { const k = new SeededPlan({ seed: s, profile: 'mixed', workload }).fate('t2', 1); counts[k.kind] = (counts[k.kind] || 0) + 1; }
  const rate = (k) => (counts[k] || 0) / trials;
  const p = PROFILES.mixed;
  for (const kind of ['crash_before', 'crash_after', 'hang', 'delay', 'invalid', 'false_claim']) {
    assert.ok(Math.abs(rate(kind) - p[kind]) < 0.01, `${kind}: observed ${rate(kind).toFixed(3)}, expected ${p[kind]}`);
  }
  assert.ok(Math.abs(rate('normal') - (1 - 0.32)) < 0.015);
});

test('fault plan: dependency_failure targets exactly one task; cancel time is half the critical path', () => {
  const workload = buildWorkload('diamond-lattice-16');
  const dep = new SeededPlan({ seed: 1, profile: 'dependency_failure', workload });
  const failing = workload.spec.tasks.filter((t) => [1, 2, 3].every((a) => dep.fate(t.id, a).kind === 'permanent_failure'));
  assert.deepEqual(failing.map((t) => t.id), [workload.fail_task]);
  const cancel = new SeededPlan({ seed: 1, profile: 'cancel', workload });
  assert.equal(cancel.cancelAt, Math.round(workload.critical_path_ms * 0.5));
  assert.throws(() => new SeededPlan({ seed: 1, profile: 'nope', workload }), /unknown fault profile/);
});

test('runTrial is deterministic: identical inputs give identical metrics, regardless of what ran in between', async () => {
  const workload = buildWorkload('random-dag-32');
  const first = await runTrial({ workload, profile: 'mixed', seed: 11, policy: 'gated' });
  await runTrial({ workload, profile: 'crash', seed: 99, policy: 'naive-parallel' });
  const second = await runTrial({ workload, profile: 'mixed', seed: 11, policy: 'gated' });
  assert.deepEqual(first, second);
});

test('paired design: across policies, the same (task, attempt) always meets the same fate', async () => {
  const workload = buildWorkload('random-dag-32');
  const observed = new Map(); // "task.attempt" -> Map(policy -> fate kind + duplicate flag)
  for (const policy of POLICIES) {
    const plan = new SeededPlan({ seed: 21, profile: 'mixed', workload });
    const real = plan.fate.bind(plan);
    plan.fate = (taskId, attemptNo) => {
      const fate = real(taskId, attemptNo);
      const key = `${taskId}.${attemptNo}`;
      if (!observed.has(key)) observed.set(key, new Map());
      observed.get(key).set(policy, `${fate.kind}/${fate.duplicate}`);
      return fate;
    };
    await runTrial({ workload, profile: 'mixed', seed: 21, policy, plan });
  }
  let shared = 0;
  for (const [key, byPolicy] of observed) {
    assert.equal(new Set(byPolicy.values()).size, 1, `attempt ${key} met different fates under different policies: ${JSON.stringify([...byPolicy])}`);
    if (byPolicy.size > 1) shared++;
  }
  assert.ok(shared >= workload.spec.tasks.length, 'policies overlap on at least every first attempt, so the check is not vacuous');
  assert.ok([...observed.keys()].some((k) => k.endsWith('.2')), 'retries were exercised too');
});

test('the gated policy never violates a protocol invariant across a broad sweep (audit_violations stays 0)', async () => {
  let audited = 0;
  for (const workload of allWorkloads()) {
    for (const profile of Object.keys(PROFILES)) {
      for (let seed = 0; seed < 6; seed++) {
        for (const policy of ['gated', 'gated-sequential']) {
          const m = await runTrial({ workload, profile, seed, policy });
          assert.equal(m.audit_violations, 0, `${workload.id}/${profile}/${policy}/seed${seed}`);
          assert.equal(m.false_success_rate === null ? 0 : m.false_success_rate, 0, 'a gated run never reports a wrong success when requirements are complete');
          assert.equal(m.duplicate_effect_rate === null ? 0 : m.duplicate_effect_rate, 0);
          assert.equal(m.dependency_order_violations, 0);
          assert.equal(m.cap_exceeded, false);
          audited++;
        }
      }
    }
  }
  assert.equal(audited, 5 * 10 * 6 * 2);
});

test('gated honours cancellation: no effects begin after the request', async () => {
  for (const workload of allWorkloads()) {
    for (let seed = 0; seed < 10; seed++) {
      const m = await runTrial({ workload, profile: 'cancel', seed, policy: 'gated' });
      assert.equal(m.effects_after_cancel, 0, `${workload.id}/seed${seed}`);
    }
  }
});

test('stats: percentiles, means and latency summaries on known data', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([10, 20], 50), 15);
  assert.equal(percentile([], 50), null);
  assert.equal(mean([]), null);
  assert.deepEqual(latencySummary([5, 1, 3]), { n: 3, p50: 3, p95: 4.8, max: 5 });
  assert.deepEqual(latencySummary([]), { n: 0, p50: null, p95: null, max: null });
});

test('stats: bootstrap CI is deterministic, brackets the mean, and narrows with more data', () => {
  const small = Array.from({ length: 30 }, (_, i) => (i % 2 ? 1 : 0));
  const large = Array.from({ length: 3000 }, (_, i) => (i % 2 ? 1 : 0));
  const a = bootstrapMeanCI(small, { label: 'x' });
  assert.deepEqual(a, bootstrapMeanCI(small, { label: 'x' }));
  assert.ok(a.lo < 0.5 && a.hi > 0.5);
  const b = bootstrapMeanCI(large, { label: 'x' });
  assert.ok(b.hi - b.lo < a.hi - a.lo);
  assert.deepEqual(bootstrapMeanCI([0.7], { label: 'x' }), { lo: 0.7, hi: 0.7 });
  assert.equal(bootstrapMeanCI([], { label: 'x' }), null);
});

test('stats: null means missing, not zero', () => {
  const s = summarize([1, null, 0, null, 1], 'm');
  assert.equal(s.n, 5);
  assert.equal(s.n_valid, 3);
  assert.equal(s.n_missing, 2);
  assert.ok(Math.abs(s.mean - 2 / 3) < 1e-12, 'nulls were not averaged in as zeros');
  const none = summarize([null, null], 'm');
  assert.equal(none.mean, null);
  assert.equal(none.ci95, null);
  const pd = pairedDifference([[1, 0], [null, 1], [1, null], [0, 0]], 'p');
  assert.equal(pd.n_pairs, 2, 'a pair with either side missing is dropped');
  assert.equal(pd.mean_diff, 0.5);
});

test('stats: a verdict is only issued when the CI excludes zero, and respects direction', () => {
  const clear = { n_pairs: 100, mean_diff: 0.2, ci95: { lo: 0.1, hi: 0.3 } };
  assert.equal(verdict(clear, true), 'better');
  assert.equal(verdict(clear, false), 'worse');
  assert.equal(verdict({ ...clear, ci95: { lo: -0.1, hi: 0.3 } }, true), 'inconclusive');
  assert.equal(verdict({ n_pairs: 0, mean_diff: null, ci95: null }, true), 'no-data');
});

function synthetic(policyValues) {
  const records = [];
  for (const [policy, fn] of Object.entries(policyValues)) {
    for (let seed = 0; seed < 60; seed++) {
      const row = { workload: 'w', profile: 'p', policy, seed, makespan_ms: 100, incomplete: false, cap_exceeded: false, audit_violations: null };
      for (const [name] of COMPARED_METRICS) row[name] = fn(name, seed);
      records.push(row);
    }
  }
  return records;
}

test('aggregate: paired comparison finds a real difference, calls noise inconclusive, and keeps nulls out of means', () => {
  const records = synthetic({
    base: (name, seed) => (name === 'correct_completion' ? 0.5 + (seed % 5) * 0.01 : name === 'false_success_rate' ? null : (seed % 7)),
    better: (name, seed) => (name === 'correct_completion' ? 0.9 + (seed % 5) * 0.01 : name === 'false_success_rate' ? null : (seed % 7)),
  });
  const summary = aggregate(records);
  assert.equal(summary.comparisons.length, 0, 'no configured policy pair exists in the synthetic data');
  const cell = summary.cells.find((c) => c.policy === 'base');
  assert.equal(cell.metrics.false_success_rate.mean, null);
  assert.equal(cell.metrics.false_success_rate.n_valid, 0);
  assert.ok(Math.abs(cell.metrics.correct_completion.mean - 0.52) < 0.01);
});

test('aggregate: configured pairs yield verdicts, and misaligned seeds are refused', () => {
  const mk = (gatedBetter) => synthetic({
    gated: (name, seed) => (name === 'correct_completion' ? (gatedBetter ? 0.95 : 0.5) + (seed % 3) * 0.001 : 1),
    sequential: (name, seed) => (name === 'correct_completion' ? 0.5 + (seed % 3) * 0.001 : 1),
  });
  const better = aggregate(mk(true)).comparisons.find((c) => c.a === 'gated' && c.b === 'sequential' && c.workload === 'ALL');
  assert.equal(better.metrics.correct_completion.verdict, 'better');
  assert.equal(better.metrics.attempts.verdict, 'inconclusive');
  const same = aggregate(mk(false)).comparisons.find((c) => c.a === 'gated' && c.b === 'sequential' && c.workload === 'ALL');
  assert.equal(same.metrics.correct_completion.verdict, 'inconclusive');
  const broken = mk(true);
  broken.find((r) => r.policy === 'gated' && r.seed === 3).seed = 1003;
  assert.throws(() => aggregate(broken), /pair misalignment/);
});

test('report: generated purely from the summary; shows n/a for missing values and lists every "worse" verdict', () => {
  const records = synthetic({
    gated: (name, seed) => (name === 'correct_completion' ? 0.95 : name === 'makespan_ms' ? 120 + (seed % 3) : name === 'false_success_rate' ? null : 1),
    sequential: (name, seed) => (name === 'correct_completion' ? 0.5 : name === 'makespan_ms' ? 100 + (seed % 3) : name === 'false_success_rate' ? null : 1),
  });
  const summary = aggregate(records);
  const meta = {
    label: 'synthetic', git: { commit: 'abc', dirty: false }, protocol_version: 1, dataset_version: 'x', seeds: { label: 'dev', first: 0, last: 59, count: 60 },
    params: PARAMS, environment: { node: 'v', platform: 'p' }, command: 'cmd', elapsed_seconds: 1.5,
  };
  const md = renderReport(summary, meta);
  assert.match(md, /Simulated workers/);
  assert.match(md, /## Where the gated approach is worse/);
  assert.match(md, /\| p \| gated \|[^\n]*n\/a/, 'undefined false-success rate is shown as n/a, not 0');
  const row = md.split('\n').find((l) => l.startsWith('| ALL | p | gated vs sequential | makespan_ms'));
  assert.ok(row, 'the metric on which gated is slower appears in the worse list');
  const charts = renderCharts(summary);
  for (const svg of Object.values(charts)) {
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.ok(!/NaN|undefined/.test(svg), 'chart contains no NaN/undefined');
  }
});

test('CLI bench: writes raw results, summary, meta and a report; `report` regenerates the same report', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-bench-'));
  let stderr = '';
  const code = await main(['bench', '--seeds', 'dev', '--workloads', 'chain-8,fanout-fanin-12', '--profiles', 'none,crash', '--out', out], { cwd: out, stdout: () => {}, stderr: (s) => { stderr += s; } });
  assert.equal(code, 0, stderr);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(out, 'raw.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(raw.length, 2 * 2 * POLICIES.length * 100);
  assert.ok(raw.every((r) => r.seed >= 0 && r.seed <= 99));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.seeds.count, 100);
  assert.equal(meta.dataset_version, 'workloads-v1');
  assert.equal(typeof meta.git.commit, 'string');
  const first = fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8');
  fs.writeFileSync(path.join(out, 'REPORT.md'), 'stale');
  assert.equal(await main(['report', out], { cwd: out, stdout: () => {}, stderr: () => {} }), 0);
  assert.equal(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8'), first, 'report is reproducible from the saved summary');
  assert.ok(fs.existsSync(path.join(out, 'charts', 'correct_completion.svg')));
  assert.equal(await main(['bench', '--seeds', 'bogus'], { cwd: out, stdout: () => {}, stderr: () => {} }), 1);
});
