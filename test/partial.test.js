'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { PARTIAL, baselineInvariance, runPartial } = require('../src/bench/partial');
const { SEED_SETS } = require('../src/bench/cli');
const { runTrial } = require('../src/bench/runner');
const { buildWorkload } = require('../src/bench/workloads');
const { ScriptedPlan } = require('../src/sim/faultplan');
const { main } = require('../src/cli/main');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-partial-'));

test('partial-requirements: the held-out seeds are new, disjoint from every other seed range, and 500 per cell', () => {
  const { dev, final } = SEED_SETS;
  assert.equal(PARTIAL.first, 20000);
  assert.equal(PARTIAL.count, 500);
  assert.ok(PARTIAL.first > final.first + final.count - 1 && PARTIAL.first > dev.first + dev.count - 1);
  assert.deepEqual([...PARTIAL.policies], ['naive-parallel-timeout', 'gated']);
  assert.deepEqual([...PARTIAL.requirement_sets], ['full', 'digest-only', 'shape-only']);
});

test('partial-requirements: a well-formed wrong output passes a shape-only gate but not a digest gate', async () => {
  const plan = () => new ScriptedPlan({ 't1.1': { kind: 'false_claim' } });
  const shape = await runTrial({ workload: buildWorkload('chain-8', { requirements: 'shape-only' }), profile: 'none', seed: 1, policy: 'gated', plan: plan() });
  assert.ok(shape.n_false_success >= 1, 'the gate had nothing to compare the content against');
  assert.ok(shape.correct_completion < 1);
  assert.equal(shape.audit_violations, 0, 'the log is consistent with the requirements it was given; it cannot know they were too weak');

  for (const requirements of ['digest-only', 'full']) {
    const m = await runTrial({ workload: buildWorkload('chain-8', { requirements }), profile: 'none', seed: 1, policy: 'gated', plan: plan() });
    assert.equal(m.n_false_success, 0, requirements);
    assert.equal(m.correct_completion, 1, `${requirements}: the wrong output was rejected and the retry was right`);
  }
});

test('partial-requirements: the baseline cannot see requirements, so its metrics are identical under every set', async () => {
  for (const profile of ['false_claim', 'mixed']) {
    const results = [];
    for (const requirements of PARTIAL.requirement_sets) {
      const workload = buildWorkload('fanout-fanin-12', { requirements });
      results.push(await runTrial({ workload, profile, seed: 7, policy: 'naive-parallel-timeout' }));
    }
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  }
  assert.deepEqual(baselineInvariance([
    { workload: 'w', profile: 'p', requirements: 'a', policy: 'naive-parallel-timeout', seed: 1, x: 1 },
    { workload: 'w', profile: 'p', requirements: 'b', policy: 'naive-parallel-timeout', seed: 1, x: 2 },
    { workload: 'w', profile: 'p', requirements: 'a', policy: 'gated', seed: 1, x: 3 },
  ]), { compared: 1, mismatches: 1 }, 'a real difference between sets is detected');
});

test('partial-requirements: a small run on non-held-out seeds writes the four artifacts, and the report regenerates identically', async () => {
  const dir = path.join(tmp(), 'out');
  const first = 0;
  const count = 4; // development seeds only: the held-out seeds are for the one real run
  const workloadIds = ['chain-8', 'fanout-fanin-12'];
  const result = await runPartial({ outDir: dir, first, count, workloadIds });
  assert.equal(result.runs, workloadIds.length * 3 * 2 * 2 * count);

  for (const name of ['raw.jsonl.gz', 'summary.json', 'meta.json', 'REPORT.md']) assert.ok(fs.existsSync(path.join(dir, name)), name);
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'raw.jsonl.gz'))).toString('utf8').trim().split('\n');
  assert.equal(lines.length, result.runs);
  const firstRecord = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(firstRecord).slice(0, 5), ['workload', 'profile', 'requirements', 'policy', 'seed']);

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.experiment, 'partial-requirements');
  assert.equal(meta.protocol_version, 2);
  assert.equal(meta.base_protocol_version, 1);
  assert.deepEqual(meta.seeds, { label: 'extension A held-out', first, last: first + count - 1, count });
  assert.ok(typeof meta.git.commit === 'string' && (meta.git.dirty === null || typeof meta.git.dirty === 'boolean'));
  assert.deepEqual(meta.requirement_counts['shape-only']['chain-8'], { artifact_json: 8 });
  assert.deepEqual(meta.requirement_counts['digest-only']['chain-8'], { artifact_sha256: 8 });

  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  assert.equal(summary.baseline_invariance.mismatches, 0);
  assert.ok(summary.baseline_invariance.compared > 0);
  const gated = (profile, set) => summary.pooled.find((c) => c.policy === 'gated' && c.profile === `${profile}@${set}`);
  assert.equal(gated('false_claim', 'full').metrics.false_success_rate.mean, 0);
  assert.equal(gated('false_claim', 'digest-only').metrics.false_success_rate.mean, 0);
  assert.ok(gated('false_claim', 'shape-only').metrics.false_success_rate.mean > 0, 'with no content check, some false claims get through');
  assert.equal(summary.requirement_effect.length, 2 * 2);

  const report = fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8');
  assert.match(report, /Simulated workers/);
  assert.match(report, /extension A/);
  assert.match(report, /shape-only/);
  fs.writeFileSync(path.join(dir, 'REPORT.md'), 'stale');
  const out = [];
  const code = await main(['report', dir], { cwd: dir, stdout: (s) => out.push(s), stderr: () => {} });
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8'), report, 'report is a pure function of summary.json and meta.json');
});

test('partial-requirements: provenance marks a dirty tree and names the files', async () => {
  const dir = path.join(tmp(), 'out');
  await runPartial({ outDir: dir, first: 0, count: 1, workloadIds: ['chain-8'] });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const report = fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8');
  if (meta.git.dirty) {
    assert.ok(Array.isArray(meta.git.dirty_files) && meta.git.dirty_files.length > 0);
    assert.match(report, /working tree had uncommitted changes/);
  } else {
    assert.doesNotMatch(report, /working tree had uncommitted changes/);
  }
});

test('partial-requirements: the CLI route fixes workloads and profiles, and unknown seed sets still list every valid choice', async () => {
  const cwd = tmp();
  let err = '';
  const io = { cwd, stdout: () => {}, stderr: (s) => { err += s; } };
  assert.equal(await main(['bench', '--seeds', 'partial-requirements', '--workloads', 'chain-8', '--out', 'x'], io), 1);
  assert.match(err, /protocol fixes it/);
  assert.ok(!fs.existsSync(path.join(cwd, 'x')), 'nothing was run or written');
  err = '';
  assert.equal(await main(['bench', '--seeds', 'nope'], io), 1);
  assert.match(err, /"dev", "final" or "partial-requirements"/);
});
