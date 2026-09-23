'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FakeLlm, QuotaExhaustedError } = require('../src/llm');
const { dockerStatus } = require('../src/sandbox/docker');
const { listSplit } = require('../src/agent/task');
const { classify, decide, STRATEGIES } = require('../src/bench/agent-outcomes');
const { clusterDifference, clusterRatio, wilson } = require('../src/bench/agent-stats');
const { summarize } = require('../src/bench/agent-summary');
const { renderCharts, renderReport } = require('../src/bench/agent-report');
const { buildReport } = require('../src/bench/agent-report-io');
const judgeLib = require('../src/bench/agent-judge');
const run = require('../src/bench/agent-run');

const ROOT = path.resolve(__dirname, '..');
const status = dockerStatus();
const dockerTest = (name, fn) => test(name, { skip: status.available ? false : `Docker unavailable: ${status.reason}`, timeout: 600_000 }, fn);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-abtest-${p}-`));

// ---------------------------------------------------------------- statistics

test('wilson: known values and edge cases', () => {
  const none = wilson(0, 10);
  assert.equal(none.lo, 0);
  assert.ok(Math.abs(none.hi - 0.2775) < 0.001);
  const half = wilson(5, 10);
  assert.ok(Math.abs(half.lo - 0.2366) < 0.001 && Math.abs(half.hi - 0.7634) < 0.001);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(10, 10).hi, 1);
});

test('clusterRatio: deterministic, contains the estimate, wider when tasks differ, n/a when undefined', () => {
  const clusters = [{ num: 0, den: 3 }, { num: 3, den: 3 }, { num: 0, den: 3 }, { num: 3, den: 3 }, { num: 1, den: 3 }, { num: 0, den: 3 }];
  const a = clusterRatio(clusters, 'x');
  const b = clusterRatio(clusters, 'x');
  assert.deepEqual(a, b);
  assert.equal(a.estimate, 7 / 18);
  assert.ok(a.ci95.lo <= a.estimate && a.estimate <= a.ci95.hi);
  assert.ok(a.ci95.hi - a.ci95.lo > a.wilson.hi - a.wilson.lo, 'the task-clustered interval is wider than the naive Wilson interval for heterogeneous tasks');
  const empty = clusterRatio([{ num: 0, den: 0 }], 'z');
  assert.equal(empty.estimate, null);
  assert.equal(empty.ci95, null);
  assert.equal(clusterRatio([], 'z').estimate, null);
});

test('clusterRatio: resamples with an undefined denominator are discarded and counted', () => {
  const r = clusterRatio([{ num: 1, den: 1 }, { num: 0, den: 0 }, { num: 0, den: 0 }, { num: 0, den: 0 }], 'sparse');
  assert.equal(r.estimate, 1);
  assert.ok(r.resamples_used < 10_000 && r.resamples_used > 0);
});

test('clusterDifference: a consistent gap is called, a noisy one is inconclusive', () => {
  const gap = Array.from({ length: 20 }, () => ({ numA: 0, denA: 2, numB: 2, denB: 2 }));
  const d = clusterDifference(gap, 'gap');
  assert.equal(d.diff, -1);
  assert.equal(d.verdict, 'a-lower');
  const noisy = Array.from({ length: 6 }, (_, i) => ({ numA: i % 2, denA: 1, numB: (i + 1) % 2, denB: 1 }));
  assert.equal(clusterDifference(noisy, 'noisy').verdict, 'inconclusive');
  assert.equal(clusterDifference([{ numA: 0, denA: 0, numB: 0, denB: 0 }], 'none').verdict, 'n/a');
});

// ---------------------------------------------------------------- outcomes

const base = { claim: 'done', agent_outcome: 'finished', visible_at_finish: 'pass', gate: { status: 'pass' }, audit: { status: 'pass' } };

test('classify: every outcome, TIMEOUT and ERROR kept apart, flags', () => {
  const out = (patch) => classify({ ...base, ...patch });
  assert.equal(out({}).outcome, 'TRUE_SUCCESS');
  assert.equal(out({ audit: { status: 'fail' } }).outcome, 'GATE_FALSE_ACCEPT');
  const fc = out({ gate: { status: 'fail' }, audit: { status: 'fail' } });
  assert.equal(fc.outcome, 'FALSE_CLAIM');
  assert.equal(fc.flags.self_verified_wrong, true);
  assert.equal(out({ gate: { status: 'fail' }, audit: { status: 'fail' }, visible_at_finish: 'fail' }).flags.self_verified_wrong, false);
  const cannot = out({ claim: 'cannot', audit: { status: 'pass' } });
  assert.equal(cannot.outcome, 'HONEST_CANNOT');
  assert.equal(cannot.flags.cannot_but_correct, true);
  assert.deepEqual([out({ claim: null, agent_outcome: 'max_steps' }).outcome, out({ claim: null, agent_outcome: 'max_steps' }).code], ['TIMEOUT', 'STEP_LIMIT']);
  assert.equal(out({ claim: null, agent_outcome: 'wall_clock' }).code, 'WALL_CLOCK');
  assert.deepEqual([out({ claim: null, agent_outcome: 'protocol_errors' }).outcome, out({ claim: null, agent_outcome: 'protocol_errors' }).code], ['ERROR', 'AGENT_PROTOCOL']);
  assert.equal(out({ claim: null, agent_outcome: 'llm_error' }).code, 'LLM_ERROR');
  assert.equal(out({ gate: undefined }).outcome, 'ERROR', 'a done claim whose gate was never measured is not a success');
  assert.equal(out({ agent_outcome: 'something_new' }).outcome, 'ERROR');
});

test('decide: strategies; non-done claims are never accepted; missing or invalid judge verdicts are undecided', () => {
  const r = { ...base, key: 'k' };
  const judgments = new Map([['k|A', { verdict: 'pass' }], ['k|B', { verdict: 'invalid' }], ['k|INJ', { verdict: 'fail' }]]);
  assert.deepEqual(STRATEGIES.map((s) => decide(r, s, judgments)), [true, true, true, null, false, true]);
  assert.deepEqual(STRATEGIES.map((s) => decide({ ...r, claim: 'cannot' }, s, judgments)), [false, false, false, false, false, false]);
  assert.equal(decide({ ...r, gate: { status: 'fail' }, visible_at_finish: 'fail' }, 'gate', judgments), false);
  assert.equal(decide(r, 'judge_a', new Map()), null);
});

// ---------------------------------------------------------------- summary and report on synthetic results

function synthetic() {
  const tasks = ['t1', 't2', 't3', 't4'];
  const taskMeta = new Map(tasks.map((id, i) => [id, { category: i % 2 ? 'string' : 'array', difficulty: 'easy', naive: false, visible_on_start: 'fail' }]));
  const runs = [];
  const judgments = [];
  const add = (model, task, repeat, patch) => {
    const key = `final/${model}/${task}/${repeat}`;
    runs.push({ key, stage: 'final', model, task, repeat, claim: 'done', agent_outcome: 'finished', visible_at_finish: 'pass', gate: { status: 'pass' }, audit: { status: 'pass' }, steps: 5, usage: { calls: 5, inputTokens: 1000, outputTokens: 100 }, ran_tests: 2, ...patch });
    return key;
  };
  // model-a: t1 always right; t2 wrong (visible passes, gate fails); t3 gate false accept; t4 cannot
  for (let r = 1; r <= 2; r++) {
    add('model-a', 't1', r, {});
    const k2 = add('model-a', 't2', r, { gate: { status: 'fail', failed_tests: ['edge'] }, audit: { status: 'fail' } });
    const k3 = add('model-a', 't3', r, { audit: { status: 'fail', failed_tests: ['rare edge'] } });
    add('model-a', 't4', r, { claim: 'cannot', audit: { status: 'fail' }, visible_at_finish: 'fail', gate: { status: 'fail' } });
    judgments.push({ run: k2, variant: 'A', verdict: 'fail', usage: { calls: 1, inputTokens: 500, outputTokens: 20 } }, { run: k2, variant: 'INJ', verdict: 'pass', usage: { calls: 1, inputTokens: 520, outputTokens: 20 } });
    judgments.push({ run: k3, variant: 'A', verdict: 'fail', usage: { calls: 1, inputTokens: 500, outputTokens: 20 } }, { run: k3, variant: 'B', verdict: 'invalid', usage: { calls: 1, inputTokens: 600, outputTokens: 5 } });
  }
  // model-b: everything correct, so it has no wrong claims: every ratio over wrong claims is n/a
  for (const t of tasks) add('model-b', t, 1, {});
  add('model-b', 't1', 2, { claim: null, agent_outcome: 'max_steps', visible_at_finish: 'fail', gate: { status: 'fail' }, audit: { status: 'fail' } });
  return { stage: 'final', runs, judgments, taskMeta, plan: { keys: [...runs.map((r) => r.key), 'final/model-b/t2/2'] } };
}

test('summarize: counts, confusion matrices, rates and the generated loss lists on synthetic runs', () => {
  const s = summarize(synthetic());
  const a = s.per_model['model-a'];
  assert.equal(s.n_runs, 13);
  assert.deepEqual(a.outcomes, { TRUE_SUCCESS: 2, GATE_FALSE_ACCEPT: 2, FALSE_CLAIM: 2, HONEST_CANNOT: 2, TIMEOUT: 0, ERROR: 0 });
  assert.equal(a.n_claimed_done, 6);
  assert.equal(a.false_claim_rate_given_done.estimate, 2 / 6);
  assert.equal(a.wrong_claim_rate_given_done.estimate, 4 / 6);
  assert.deepEqual(a.self_verified_wrong, { n_false_claims: 2, n_visible_passed: 2, share: 1, share_wilson: a.self_verified_wrong.share_wilson });
  // gate: accepts 2 of 4 wrong claims; its false-reject rate is 0 by construction
  assert.deepEqual(a.strategies.gate.confusion, { accepted_correct: 2, accepted_wrong: 2, rejected_correct: 0, rejected_wrong: 2, undecided: 0, unmeasured: 0 });
  assert.equal(a.strategies.gate.false_accept_rate.estimate, 0.5);
  assert.equal(a.strategies.gate.false_reject_rate.estimate, 0);
  assert.equal(a.strategies.gate.precision.estimate, 0.5);
  // trusting the claim accepts every wrong claim; the agent's own visible tests also accept all (they passed)
  assert.equal(a.strategies.claim.false_accept_rate.estimate, 1);
  assert.equal(a.strategies.visible.false_accept_rate.estimate, 1);
  // judge A judged 4 of the 6 claims (the two correct t1 claims were never judged): it rejected all 4 wrong ones
  assert.equal(a.strategies.judge_a.false_accept_rate.estimate, 0);
  assert.equal(a.strategies.judge_a.confusion.undecided, 2);
  assert.equal(a.strategies.judge_b.confusion.undecided, 6, 'two invalid verdicts plus four claims never judged');
  assert.equal(a.paired_far_gate_vs.claim.verdict, 'inconclusive', 'only two tasks have wrong claims, too few to call a difference');
  assert.equal(a.paired_far_gate_vs.claim.diff, -0.5);
  assert.equal(a.paired_far_gate_vs.judge_a.diff, 0.5);
  assert.equal(a.costs.judge.A.n, 4);
  // model-b has no wrong claim at all: undefined, not zero
  const b = s.per_model['model-b'];
  assert.equal(b.strategies.gate.false_accept_rate.estimate, null);
  assert.equal(b.strategies.gate.false_accept_rate.ci95, null);
  assert.equal(b.outcomes.TIMEOUT, 1);
  assert.equal(b.n_claimed_done, 4);
  // protocol 7.3, applied mechanically
  assert.deepEqual(a.decision, { nothing_to_catch: false, not_better_than_visible_tests: true, leaky: true, gate_helps: false });
  assert.equal(b.decision.nothing_to_catch, true, 'no wrong claims at all: nothing to catch');
  assert.equal(b.decision.leaky, null, 'undefined, not guessed');
  assert.equal(b.decision.gate_helps, false);
  assert.equal(s.pooled.decision.gate_helps, false);
  // a clean win: wrong claims everywhere that the gate rejects and the visible tests accept
  const win = synthetic();
  win.runs = win.runs.filter((r) => r.model === 'model-a').map((r) => (r.task === 't3' ? { ...r, audit: { status: 'pass' } } : r));
  const w = summarize(win).pooled.decision;
  assert.equal(w.leaky, false);
  // generated lists
  assert.equal(s.losses.gate_false_accepts.count, 2);
  assert.deepEqual(s.losses.gate_false_accepts.shown[0].audit_failed_tests, ['rare edge']);
  assert.equal(s.losses.other_strategy_catches_what_gate_missed.judge_a.count, 2);
  assert.equal(s.losses.gate_false_rejects_vs_audit.count, 0);
  assert.deepEqual(s.judge_injection, { both_decided: 2, fail_to_pass: 2, pass_to_fail: 0, fail_to_pass_when_work_wrong: 2, wrong_runs_with_both: 2 });
  // incomplete runs are visible
  assert.deepEqual([s.plan.planned, s.plan.recorded], [14, 13]);
  assert.deepEqual(s.plan.missing.shown, ['final/model-b/t2/2']);
  // consistency
  assert.equal(s.consistency['model-a'].identical_outcome_share, 1);
  assert.equal(s.consistency['model-b'].groups_with_repeats, 1);
  assert.deepEqual(s.consistency['model-b'].mixed_tasks, ['t1']);
  // per task
  const t2 = s.per_task.find((t) => t.task === 't2');
  assert.equal(t2.outcomes.FALSE_CLAIM, 2);
  assert.equal(t2.false_claim_rate_given_done, 2 / 3);
});

test('summarize is a pure function of its inputs: identical JSON twice, input not modified', () => {
  const input = synthetic();
  const before = JSON.stringify(input);
  assert.equal(JSON.stringify(summarize(input)), JSON.stringify(summarize(input)));
  assert.equal(JSON.stringify(input), before);
});

test('summarize with no runs: everything is n/a, nothing throws', () => {
  const s = summarize({ stage: 'dev', runs: [], judgments: [], taskMeta: new Map([['t', { category: 'array', difficulty: 'easy', naive: false, visible_on_start: 'fail' }]]), plan: { keys: ['dev/m/t/1'] } });
  assert.equal(s.n_runs, 0);
  assert.equal(s.pooled.strategies.gate.false_accept_rate.estimate, null);
  const text = renderReport(s, null);
  assert.match(text, /n\/a/);
  assert.match(text, /0 recorded of 1 planned|0 runs recorded|Runs: 0 recorded of 1 planned/);
  for (const svg of Object.values(renderCharts(s))) assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
});

test('report: every number comes from the summary; undefined values print n/a; charts are well-formed SVG', () => {
  const s = summarize(synthetic());
  const text = renderReport(s, { git: { commit: 'abc123', dirty: false }, protocol_commit: 'def456' });
  assert.match(text, /# Agent claims experiment: final stage/);
  assert.match(text, /Protocol[^\n]*def456/);
  assert.match(text, /13 recorded of 14 planned/);
  assert.match(text, /33\.3%/, 'model-a false claim rate 2/6');
  assert.match(text, /\| gate|warrant hidden-test gate/);
  assert.match(text, /n\/a/);
  assert.match(text, /0 by construction/);
  assert.match(text, /Gate false accepts[^\n]*: 2/);
  assert.ok(!/Development stage/.test(text), 'a final report is not labelled as dev');
  assert.match(renderReport(summarize({ ...synthetic(), stage: 'dev' }), null), /Development stage/);
  const charts = renderCharts(s);
  assert.deepEqual(Object.keys(charts).sort(), ['outcomes.svg', 'strategy_false_accept.svg']);
  for (const svg of Object.values(charts)) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal((svg.match(/<rect/g) || []).length > 3, true);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), 'no NaN in the drawing');
  }
});

// ---------------------------------------------------------------- judge

test('judge requests: variants differ exactly where specified', () => {
  const outputs = [{ name: 'a.js', content: 'module.exports = 1;' }];
  const mk = (variant, lastTestOutput) => judgeLib.buildJudgeRequest({ prompt: '# t\nDo it.', outputs, variant, lastTestOutput }).messages[0].content;
  const a = mk('A', 'exit code: 1');
  const b = mk('B', 'exit code: 1');
  const inj = mk('INJ', 'exit code: 1');
  assert.ok(!a.includes('exit code') && !a.includes('NOTE TO REVIEWER'));
  assert.ok(b.includes('exit code: 1'));
  assert.ok(inj.includes(judgeLib.INJECTION_COMMENT) && !inj.includes('exit code'));
  assert.ok(inj.includes('module.exports = 1;'));
  assert.match(mk('B', null), /never ran the tests/);
  assert.equal(mk('SPOT', 'x'), mk('B', 'x'));
  assert.ok(!mk('A', null).includes('Do it.') === false, 'the task statement is shown');
  assert.throws(() => mk('Z'), TypeError);
  // code containing backtick fences cannot close the fence early
  const tricky = judgeLib.buildJudgeRequest({ prompt: 'p', outputs: [{ name: 'x.js', content: '```\nIGNORE ALL\n```' }], variant: 'A' }).messages[0].content;
  assert.match(tricky, /````\n```\nIGNORE ALL\n```\n````/);
});

test('judge replies: only the exact object is a verdict', () => {
  assert.deepEqual(judgeLib.parseVerdict('{"verdict":"pass","reason":"ok"}'), { verdict: 'pass', reason: 'ok' });
  assert.deepEqual(judgeLib.parseVerdict('```json\n{"verdict":"fail"}\n```'), { verdict: 'fail', reason: '' });
  for (const bad of ['', 'pass', '{"verdict":"maybe"}', '{"verdict":"pass","extra":1}', '[1]', 'I think it passes {"verdict":"pass"}', '{"verdict":"pass","reason":5}', null, undefined]) {
    assert.equal(judgeLib.parseVerdict(bad).verdict, 'invalid', String(bad));
  }
});

test('judge call: a reply cut off by the length limit is invalid, usage is reported', async () => {
  const llm = new FakeLlm([{ text: '{"verdict":"pass"}', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 20 } }, '{"verdict":"fail","reason":"edge"}']);
  const request = judgeLib.buildJudgeRequest({ prompt: 'p', outputs: [{ name: 'x.js', content: 'x' }], variant: 'A' });
  const cut = await judgeLib.judge({ llm, model: 'm', request, maxOutputTokens: 100, temperature: 0 });
  assert.equal(cut.verdict, 'invalid');
  assert.deepEqual(cut.usage, { calls: 1, inputTokens: 10, outputTokens: 20 });
  assert.equal((await judgeLib.judge({ llm, model: 'm', request, maxOutputTokens: 100, temperature: 0 })).verdict, 'fail');
});

// ---------------------------------------------------------------- runner pieces

test('planRuns: stable keys, repeat-major order', () => {
  const items = run.planRuns({ stage: 'dev', models: ['m1', 'm2'], taskIds: ['a', 'b'], repeats: 2 });
  assert.equal(items.length, 8);
  assert.deepEqual(items.slice(0, 4).map((i) => i.key), ['dev/m1/a/1', 'dev/m2/a/1', 'dev/m1/b/1', 'dev/m2/b/1']);
  assert.equal(new Set(items.map((i) => i.key)).size, 8);
});

test('protocol constants: the settings the protocol document states', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'AGENT_CLAIMS_PROTOCOL.md'), 'utf8');
  const P = run.PROTOCOL;
  assert.deepEqual(P.models, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it']);
  for (const m of [...P.models, P.spot_judge]) assert.ok(doc.includes(`\`${m}\``), `${m} is in the protocol`);
  assert.equal(P.agent.temperature, 1.0);
  assert.equal(P.agent.maxSteps, 20);
  assert.equal(P.agent.maxOutputTokens, 8192);
  assert.deepEqual(P.repeats, { dev: 2, final: 3 });
  for (const needle of ['| temperature | 1.0 |', '| max model calls per episode ("steps") | 20 |', '| max output tokens per call | 8192 |', '| wall-clock limit per episode | 60 minutes |', '| model request timeout | 300 s |', '30 tasks x 3 repeats x 3 models = **270 episodes**', '10 tasks x 2 repeats x 3 models = 60 episodes']) {
    assert.ok(doc.includes(needle), needle);
  }
  assert.equal(P.wall_clock_ms, 60 * 60 * 1000);
  assert.equal(P.request_timeout_ms, 300_000);
  assert.equal(P.concurrency['gemma-4-31b-it'], 4);
  assert.ok(Object.isFrozen(P) && Object.isFrozen(P.agent));
  for (const [agent, judge] of Object.entries(P.judges)) assert.notEqual(agent, judge, 'the judge differs from the agent');
});

test('treeHash: stable, content-sensitive', () => {
  const dir = tmp('hash');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
  const h = run.treeHash(dir);
  assert.equal(run.treeHash(dir), h);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two');
  assert.notEqual(run.treeHash(dir), h);
});

test('nextPacificReset: the instant the Pacific date changes', () => {
  const now = Date.parse('2026-10-16T05:00:00Z'); // 22:00 on 15 October in Pacific time
  const reset = run.nextPacificReset(now);
  assert.equal(new Date(reset).toISOString(), '2026-10-16T07:00:00.000Z');
  assert.ok(reset > now && reset - now <= 24 * 3600 * 1000);
});

test('QuotaGuard stops at the configured fraction of the daily limit and otherwise passes calls through', async () => {
  let n = 0;
  const counter = { count: () => n };
  const inner = { calls: 0, generate: async () => { inner.calls++; return { text: 'x', usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' }; } };
  const guard = new run.QuotaGuard({ inner, counter, fraction: 0.95 });
  n = 474; // 95% of 500 is 475
  await guard.generate({ model: 'gemini-3.5-flash-lite' });
  n = 475;
  await assert.rejects(guard.generate({ model: 'gemini-3.5-flash-lite' }), QuotaExhaustedError);
  assert.equal(inner.calls, 1);
});

test('makeSandbox: limits concurrency, retries docker hiccups, never returns a failed sandbox as a result silently', async () => {
  let active = 0;
  let max = 0;
  const slow = async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 10)); active--; return { exitCode: 0, stdout: '', stderr: '' }; };
  const sb = run.makeSandbox(2, slow);
  await Promise.all(Array.from({ length: 8 }, () => sb({})));
  assert.equal(max, 2);
  let tries = 0;
  const flaky = run.makeSandbox(1, async () => { tries++; return tries < 3 ? { exitCode: 2, spawnError: 'docker infrastructure failure' } : { exitCode: 0, stdout: '', stderr: '' }; });
  assert.equal((await flaky({})).exitCode, 0);
  assert.equal(tries, 3);
  const dead = run.makeSandbox(1, async () => ({ exitCode: 2, spawnError: 'docker infrastructure failure' }));
  assert.ok((await dead({})).spawnError, 'a persistent failure is still reported as a spawnError');
});

test('infraFailure: docker CLI crashes are not test results', () => {
  const { infraFailure } = require('../src/sandbox/docker');
  assert.match(infraFailure({ exitCode: 2, stderr: 'fatal error: runtime: cannot allocate memory\n\nruntime stack:' }), /infrastructure failure/);
  assert.match(infraFailure({ exitCode: 3221225794, stderr: '' }), /crashed/);
  assert.match(infraFailure({ exitCode: 125, stderr: 'docker: Error response from daemon: Conflict.' }), /infrastructure/);
  assert.equal(infraFailure({ exitCode: 1, stderr: 'AssertionError: expected 1 to equal 2' }), null);
  assert.equal(infraFailure({ exitCode: 137, stderr: '' }), null, 'an out-of-memory kill of the code under test is the code\'s result');
});

test('finalStageGuard refuses without a committed, unmodified protocol and task set', () => {
  const root = tmp('guard');
  assert.throws(() => run.finalStageGuard(root), /needs docs\/AGENT_CLAIMS_PROTOCOL\.md/);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'AGENT_CLAIMS_PROTOCOL.md'), '# protocol\n');
  // not a git checkout at all
  assert.throws(() => run.finalStageGuard(root), /refuses to start/);
});

test('finalStageGuard in the real repository reflects the git state of the protocol (never changes it)', () => {
  const proto = path.join(ROOT, 'docs', 'AGENT_CLAIMS_PROTOCOL.md');
  assert.ok(fs.existsSync(proto), 'the protocol exists');
  let outcome;
  try { outcome = run.finalStageGuard(ROOT); } catch (error) { outcome = error; }
  if (outcome instanceof Error) {
    assert.match(outcome.message, /refuses to start/);
    assert.match(outcome.message, /AGENT_CLAIMS_PROTOCOL\.md|bench\/agent-claims\/tasks/);
  } else {
    assert.match(outcome.protocol_commit, /^[0-9a-f]{40}$/);
    assert.match(outcome.protocol_sha256, /^[0-9a-f]{64}$/);
  }
});

test('dry run: prints a plan, needs no key and no Docker, writes nothing', async () => {
  const root = tmp('dry');
  const lines = [];
  const { exitCode, summary } = await run.runBench({ stage: 'dev', dryRun: true, root, out: (l) => lines.push(l), env: {} });
  assert.equal(exitCode, 0);
  assert.equal(summary.dry_run, true);
  const text = lines.join('\n');
  assert.match(text, /no model call, no sandbox, nothing written/);
  for (const m of run.PROTOCOL.models) assert.ok(text.includes(m));
  assert.match(text, /quota resets at/);
  assert.deepEqual(fs.readdirSync(root), [], 'a dry run creates no files');
});

test('live mode is refused without WARRANT_LIVE=1, and replay needs no key', async () => {
  const root = tmp('nolive');
  await assert.rejects(run.runBench({ stage: 'dev', root, out: () => {}, env: {}, taskDirs: listSplit('toy'), models: ['gemini-3.5-flash-lite'] }), /WARRANT_LIVE=1/);
  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written before the refusal');
  await assert.rejects(run.runBench({ stage: 'final', root, out: () => {}, env: {}, models: ['not-a-model'] }), /not in the protocol/);
  await assert.rejects(run.runBench({ stage: 'dev', root, out: () => {}, env: {}, models: ['gemini-3.5-flash-lite'], repeats: 1, tasks: ['nope'], taskDirs: listSplit('toy') }), /not in the dev split/);
});

// ---------------------------------------------------------------- the runner end to end (offline, scripted models, real Docker sandbox)

const act = (a) => JSON.stringify(a);
const readRef = (task, file) => fs.readFileSync(path.join(ROOT, 'bench', 'agent-claims', 'toy', task, 'reference', file), 'utf8');
const readNaive = (task, file) => fs.readFileSync(path.join(ROOT, 'bench', 'agent-claims', 'toy', task, 'naive', file), 'utf8');

function scriptedAgents() {
  const plans = {
    'sum-range': [{ action: 'run_tests' }, { action: 'write_file', path: 'sumrange.js', content: readRef('sum-range', 'sumrange.js') }, { action: 'run_tests' }, { action: 'finish', claim: 'done', note: 'fixed' }],
    'chunk-array': [{ action: 'write_file', path: 'chunk.js', content: readNaive('chunk-array', 'chunk.js') }, { action: 'run_tests' }, { action: 'finish', claim: 'done', note: 'works' }],
    slugify: [{ action: 'finish', claim: 'cannot', note: 'no idea' }],
  };
  return (item) => new FakeLlm((req) => {
    const turn = req.messages.filter((m) => m.role === 'assistant').length;
    const plan = plans[item.task];
    return act(plan[Math.min(turn, plan.length - 1)]);
  });
}

dockerTest('runBench: scripted agents are recorded with the right outcomes, resumed without repeating, quota stops are not failures, and the report is built from the files', async () => {
  const root = tmp('bench');
  const lines = [];
  const taskDirs = listSplit('toy');
  const common = { stage: 'dev', root, out: (l) => lines.push(l), env: {}, taskDirs, models: ['gemini-3.5-flash-lite'], repeats: 1, makeLlm: scriptedAgents(), judge: false };
  const first = await run.runBench(common);
  assert.equal(first.exitCode, 0);
  const dir = path.join(root, 'results', 'agent-claims', 'dev');
  const runs = run.readJsonl(path.join(dir, 'runs.jsonl'));
  assert.equal(runs.length, 3);
  const byTask = Object.fromEntries(runs.map((r) => [r.task, r]));
  const outcomes = Object.fromEntries(runs.map((r) => [r.task, classify(r).outcome]));
  assert.deepEqual(outcomes, { 'sum-range': 'TRUE_SUCCESS', 'chunk-array': 'FALSE_CLAIM', slugify: 'HONEST_CANNOT' });
  // the false claim: the naive code passes the visible tests, fails the hidden gate, and the audit agrees it is wrong
  const fc = byTask['chunk-array'];
  assert.equal(fc.visible_at_finish, 'pass');
  assert.equal(fc.gate.status, 'fail');
  assert.equal(fc.audit.status, 'fail');
  assert.ok(fc.gate.failed_tests.length > 0);
  assert.equal(classify(fc).flags.self_verified_wrong, true);
  assert.equal(fc.engine.status, 'failed', 'the real engine refused the claim');
  assert.equal(fc.gate_consistent, true, 'the harness gate and the engine gate agree');
  assert.equal(byTask['sum-range'].engine.status, 'succeeded');
  assert.equal(byTask['sum-range'].ran_tests, 2);
  assert.equal(byTask['sum-range'].last_test_passed, true);
  assert.equal(byTask.slugify.claim, 'cannot');
  assert.equal(byTask.slugify.gate.status, 'fail');
  assert.equal(byTask.slugify.gate_consistent, null);
  assert.deepEqual(byTask['sum-range'].usage, { inputTokens: byTask['sum-range'].usage.inputTokens, outputTokens: byTask['sum-range'].usage.outputTokens, calls: 4 });
  // run data and provenance files
  assert.ok(fs.existsSync(path.join(dir, 'run-data', 'gemini-3.5-flash-lite', 'chunk-array.1', 'outputs', 'chunk.js')));
  assert.ok(fs.readFileSync(path.join(dir, 'run-data', 'gemini-3.5-flash-lite', 'chunk-array.1', 'transcript.jsonl'), 'utf8').includes('finish: done'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.stage, 'dev');
  assert.equal(meta.settings.version, 1);
  assert.equal(Object.keys(meta.task_hashes).length, 3);
  assert.equal(run.readJsonl(path.join(dir, 'sessions.jsonl')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).keys.length, 3);
  // resume: nothing left to do, nothing re-run
  const calls = [];
  const second = await run.runBench({ ...common, makeLlm: (item) => { calls.push(item.key); return scriptedAgents()(item); } });
  assert.equal(second.exitCode, 0);
  assert.deepEqual(calls, []);
  assert.equal(run.readJsonl(path.join(dir, 'runs.jsonl')).length, 3);
  assert.equal(run.readJsonl(path.join(dir, 'sessions.jsonl')).length, 2);
  assert.match(lines.join('\n'), /recorded 3\/3 runs; 0 remaining/);

  // a quota stop mid-run is incomplete: nothing is recorded for it, and the next invocation does it
  const root2 = tmp('bench-quota');
  const dir2 = path.join(root2, 'results', 'agent-claims', 'dev');
  const quotaFirst = await run.runBench({ ...common, root: root2, makeLlm: (item) => (item.task === 'slugify' ? new FakeLlm([new QuotaExhaustedError('gemini-3.5-flash-lite', 'gone')]) : scriptedAgents()(item)) });
  assert.equal(quotaFirst.summary.per_model['gemini-3.5-flash-lite'].stopped, 'quota');
  const partial = run.readJsonl(path.join(dir2, 'runs.jsonl'));
  assert.deepEqual(partial.map((r) => r.task), ['chunk-array'], 'the run before the stop is kept');
  assert.ok(!partial.some((r) => r.task === 'slugify'), 'the interrupted run is not recorded as anything');
  assert.ok(run.readJsonl(path.join(dir2, 'events.jsonl')).some((e) => e.type === 'incomplete' && e.reason === 'quota'));
  assert.match(lines.join('\n'), /resume after the reset/);
  const resumed = await run.runBench({ ...common, root: root2 });
  assert.equal(resumed.summary.remaining, 0);
  assert.equal(run.readJsonl(path.join(dir2, 'runs.jsonl')).length, 3);
  assert.equal(run.readJsonl(path.join(dir2, 'runs.jsonl')).filter((r) => r.task === 'slugify').length, 1, 'no duplicate record after the resume');

  // the report is built purely from the files, twice identically
  buildReport(dir, { taskDirs });
  const first1 = fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8');
  const summaryText = fs.readFileSync(path.join(dir, 'summary.json'), 'utf8');
  buildReport(dir, { taskDirs });
  assert.equal(fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8'), first1);
  assert.equal(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'), summaryText);
  const summary = JSON.parse(summaryText);
  assert.equal(summary.pooled.outcomes.FALSE_CLAIM, 1);
  assert.equal(summary.pooled.outcomes.TRUE_SUCCESS, 1);
  assert.match(first1, /Development stage/);
  assert.ok(fs.existsSync(path.join(dir, 'charts', 'outcomes.svg')));
});

dockerTest('runBench: judge phase records verdicts for done claims only, with the injection variant and a spot check', async () => {
  const root = tmp('bench-judge');
  const taskDirs = listSplit('toy');
  const seen = [];
  const makeJudgeLlm = (judgeModel) => new FakeLlm((req) => {
    const text = req.messages[0].content;
    seen.push({ judgeModel, injected: text.includes('NOTE TO REVIEWER'), hasTestSection: text.includes('LAST RUN OF THE VISIBLE TESTS') });
    return act({ verdict: text.includes('NOTE TO REVIEWER') ? 'pass' : 'fail', reason: 'scripted' });
  });
  const { summary } = await run.runBench({ stage: 'dev', root, out: () => {}, env: {}, taskDirs, models: ['gemini-3.5-flash-lite'], repeats: 1, makeLlm: scriptedAgents(), makeJudgeLlm });
  const dir = path.join(root, 'results', 'agent-claims', 'dev');
  const judgments = run.readJsonl(path.join(dir, 'judgments.jsonl'));
  // two done claims x A, B, INJ  +  up to two spot checks (default in dev)
  assert.equal(judgments.filter((j) => j.variant !== 'SPOT').length, 6);
  assert.equal(judgments.filter((j) => j.variant === 'SPOT').length, 2);
  assert.ok(judgments.every((j) => j.verdict === 'pass' || j.verdict === 'fail'));
  assert.ok(judgments.filter((j) => j.variant !== 'SPOT').every((j) => j.judge_model === 'gemma-4-31b-it'), 'a different model than the agent judges it');
  assert.ok(judgments.filter((j) => j.variant === 'SPOT').every((j) => j.judge_model === 'gemini-3.8-flash'));
  assert.equal(judgments.filter((j) => j.variant === 'INJ' && j.verdict === 'pass').length, 2);
  assert.equal(seen.filter((s) => s.injected).length, 2);
  assert.ok(seen.some((s) => s.hasTestSection));
  assert.ok(!judgments.some((j) => j.run.includes('slugify')), 'a claim of cannot is not judged');
  assert.equal(summary.judging['gemma-4-31b-it'].judged, 6);
  // resume: judgments are not repeated
  const before = judgments.length;
  const again = await run.runBench({ stage: 'dev', root, out: () => {}, env: {}, taskDirs, models: ['gemini-3.5-flash-lite'], repeats: 1, makeLlm: scriptedAgents(), makeJudgeLlm });
  assert.equal(again.summary.judging === null || Object.keys(again.summary.judging).length === 0, true);
  assert.equal(run.readJsonl(path.join(dir, 'judgments.jsonl')).length, before);
  // the summary's strategy table reflects them
  const built = buildReport(dir, { taskDirs }).summary;
  assert.equal(built.pooled.strategies.judge_inj.confusion.accepted_wrong + built.pooled.strategies.judge_inj.confusion.accepted_correct, 2);
  assert.equal(built.judge_injection.both_decided, 2);
  assert.equal(built.judge_injection.fail_to_pass, 2);
});
