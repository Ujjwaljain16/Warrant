'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AgentWorker, buildAgentRunSpec, listSplit, loadTask } = require('../agent');
const { GATE_MANIFEST, GATE_VERSION, runHiddenGate } = require('../agent/gate');
const { walkFiles } = require('../agent/task');
const { Engine } = require('../engine/engine');
const { MemoryRunLog } = require('../log/runlog');
const { CassetteClient, DailyCounter, GeminiClient, QuotaExhaustedError, limitsFor, loadApiKey, pacificDay, redactSecrets, resolveModel } = require('../llm');
const { OpenAICompatClient } = require('../llm/openai-compat');
const { RouterBudget } = require('../llm/router-budget');
const { DEFAULT_CAP_USD, estimateModelCost, isRouterAgentModel, isRouterModel, loadRouterKey, scheduledAgentModels } = require('../llm/router-models');
const { dockerStatus, imageInfo, runInSandbox, sweepStale } = require('../sandbox/docker');
const { hash32 } = require('../sim/rng');
const judgeLib = require('./agent-judge');

// The resumable experiment runner behind scripts/agent-bench.js. Design and definitions: docs/AGENT_CLAIMS_PROTOCOL.md.
// Every setting below is part of protocol v1 and is recorded in meta.json; changing one is a protocol change.
const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL_FILE = 'docs/AGENT_CLAIMS_PROTOCOL.md';
const PROTOCOL = Object.freeze({
  version: 1,
  models: Object.freeze(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it']),
  // Router arm (docs/ROUTER.md, run with --router): a third-party OpenAI-compatible router, total spend capped at $0.40 by a persistent ledger.
  // Scheduled agents come from the allowlist in src/llm/router-models.js (google/gemini-3.8-flash is allowed but optional and unscheduled; name it with --models).
  router_models: Object.freeze(scheduledAgentModels()),
  judges: Object.freeze({
    'gemini-3.5-flash-lite': 'gemma-4-31b-it', 'gemini-3.1-flash-lite': 'gemma-4-31b-it', 'gemma-4-31b-it': 'gemini-3.1-flash-lite',
    'google/gemini-3.8-flash': 'deepseek/deepseek-v4.1-flash', 'anthropic/claude-haiku-5.5': 'deepseek/deepseek-v4.1-flash', 'openai/gpt-5.4-mini': 'deepseek/deepseek-v4.1-flash',
  }),
  spot_judge: 'gemini-3.8-flash',
  repeats: Object.freeze({ dev: 2, final: 3 }),
  agent: Object.freeze({ temperature: 1.0, maxSteps: 20, maxOutputTokens: 8192, maxToolOutputChars: 6000, maxConsecutiveProtocolErrors: 3, maxTotalProtocolErrors: 8 }),
  judge: Object.freeze({ temperature: 0, maxOutputTokens: 4096 }),
  wall_clock_ms: 3_600_000,
  request_timeout_ms: 300_000,
  // Episodes run at once per model. The Gemma API answered in 35-110 s per call in the dev run, so it runs four episodes at a time;
  // the flash-lite models answer in seconds and run one.
  // Router calls took 3-36 s in the live check (docs/ROUTER.md): three episodes at a time per router agent.
  concurrency: Object.freeze({ 'gemma-4-31b-it': 4, 'google/gemini-3.8-flash': 2, 'anthropic/claude-haiku-5.5': 3, 'openai/gpt-5.4-mini': 3 }),
  gate_timeout_ms: 150_000,
  test_timeout_ms: 60_000,
  max_attempts_per_run: 3,
  stop_fraction: 0.9,
  hard_stop_fraction: 0.95,
  // Planning assumptions for --dry-run only (replaced by measured values in the report).
  planning: Object.freeze({ calls_per_run: 10, input_tokens_per_call: 2500, output_tokens_per_call: 500, judge_input_tokens: 2500, judge_output_tokens: 200 }),
});

const TRANSIENT_LLM_CODES = new Set(['SERVER_ERROR', 'NETWORK', 'RATE_LIMITED', 'EXHAUSTED_RETRIES']);
const MAX_CONSECUTIVE_UNAVAILABLE = 3;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const fileSha256 = (file) => { try { return sha256(fs.readFileSync(file)); } catch (_error) { return null; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- files

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const lines = text.split('\n').filter((l) => l.trim());
  const out = [];
  lines.forEach((line, i) => {
    try { out.push(JSON.parse(line)); } catch (error) {
      if (i === lines.length - 1) return; // a torn final line from a crash mid-append: the record was never complete
      throw new Error(`${file}: line ${i + 1} is not valid JSON`);
    }
  });
  return out;
}

function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function treeHash(dir) {
  const files = walkFiles(dir).filter((f) => !f.symlink).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f.rel); h.update('\0'); h.update(fs.readFileSync(f.full)); h.update('\0'); }
  return h.digest('hex');
}

// ---------------------------------------------------------------- git provenance and the final-stage guard

function git(root, ...args) {
  try { return execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_error) { return null; }
}

// Output directories are inside the repository and are written by this very program; they must not make the tree look dirty
// on a resume (the lesson of src/bench/cli.js: capture provenance before writing, and describe the code, not the results).
const NOT_PROVENANCE = [':(exclude)results/agent-claims', ':(exclude)bench/agent-claims/cassettes'];

function gitInfo(root) {
  const commit = git(root, 'rev-parse', 'HEAD');
  const status = git(root, 'status', '--porcelain', '--', '.', ...NOT_PROVENANCE);
  const lines = status === null ? [] : status.split('\n').filter(Boolean);
  return { commit: commit || 'unknown (not a git checkout)', dirty: status === null ? null : lines.length > 0, dirty_paths: lines.slice(0, 20).map((l) => l.slice(3)) };
}

// The final stage runs only against a protocol and a task set that are committed and unmodified, so the run can say which
// commit froze them. Returns { protocol_commit, protocol_sha256 }; throws a message naming exactly what is wrong.
function finalStageGuard(root) {
  const file = path.join(root, PROTOCOL_FILE);
  if (!fs.existsSync(file)) throw new Error(`the final stage needs ${PROTOCOL_FILE}; it does not exist`);
  const problems = [];
  // The protocol, the tasks, the pinned gate manifest and the code that decides (the gate and the sandbox) must be exactly what is committed.
  for (const rel of [PROTOCOL_FILE, 'bench/agent-claims/tasks', 'bench/agent-claims/gate-manifest.json', 'src/gate', 'src/agent/gate.js', 'src/sandbox']) {
    const status = git(root, 'status', '--porcelain', '--', rel);
    if (status === null) { problems.push('git is not available or this is not a git checkout'); break; }
    if (status !== '') problems.push(`${rel} has uncommitted changes or is untracked (commit it first):\n${status.split('\n').slice(0, 5).join('\n')}`);
    else if (!git(root, 'log', '-1', '--format=%H', '--', rel)) problems.push(`${rel} is not committed`);
  }
  if (problems.length) throw new Error(`the final stage refuses to start:\n${problems.join('\n')}`);
  return { protocol_commit: git(root, 'log', '-1', '--format=%H', '--', PROTOCOL_FILE), protocol_sha256: sha256(fs.readFileSync(file)) };
}

// ---------------------------------------------------------------- quota

// First instant after `now` at which the Pacific calendar date changes (the daily quota reset).
function nextPacificReset(now = Date.now()) {
  const today = pacificDay(now);
  let t = now;
  while (pacificDay(t) === today) t += 60_000;
  return t;
}

function istString(ms) {
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))} IST`;
}

// floor(rpd * fraction) with a tolerance: 500 * 0.95 is 474.99999999999994 in floating point.
function stopAtFor(model, fraction) {
  return Math.floor(limitsFor(model).rpd * fraction + 1e-9);
}

class QuotaGuard {
  constructor({ inner, counter, fraction }) { this.inner = inner; this.counter = counter; this.fraction = fraction; }

  async generate(request, opts) {
    const model = resolveModel(request.model);
    const stopAt = stopAtFor(model, this.fraction);
    if (this.counter.count(model) >= stopAt) throw new QuotaExhaustedError(model, `stopping at ${Math.round(this.fraction * 100)}% of the daily request limit (${stopAt})`);
    return this.inner.generate(request, opts);
  }
}

// At most `limit` sandbox containers at once (the docker CLI fails under memory pressure), and a docker hiccup is retried:
// a run is never measured from a failed sandbox.
function makeSandbox(limit = 2, run = runInSandbox) {
  let active = 0;
  const waiters = [];
  const acquire = async () => { if (active < limit) { active++; return; } await new Promise((resolve) => waiters.push(resolve)); };
  const release = () => { const next = waiters.shift(); if (next) next(); else active--; };
  return async (options) => {
    await acquire();
    try {
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = await run(options);
        if (!result.spawnError) break;
        await sleep(500 * (attempt + 1));
      }
      return result;
    } finally { release(); }
  };
}

// ---------------------------------------------------------------- planning

function planRuns({ stage, models, taskIds, repeats }) {
  const items = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of taskIds) for (const model of models) items.push({ key: `${stage}/${model}/${task}/${repeat}`, model, task, repeat });
  }
  return items;
}

function stageTasks(stage, root, override) {
  const dirs = override || listSplit(stage, path.join(root, 'bench', 'agent-claims'));
  return new Map(dirs.map((d) => { const t = loadTask(d); return [t.id, t]; }));
}

function dryRunReport({ stage, models, items, done, counter, root, now }) {
  const P = PROTOCOL.planning;
  const lines = [`agent-bench dry run (stage ${stage}): no model call, no sandbox, nothing written`, ''];
  let totalCalls = 0;
  let routerUsd = 0;
  for (const model of models) {
    const pending = items.filter((i) => i.model === model && !done.has(i.key));
    const calls = pending.length * P.calls_per_run;
    const worst = pending.length * PROTOCOL.agent.maxSteps;
    if (isRouterModel(model)) {
      const est = estimateModelCost(model, { runs: pending.length, callsPerRun: P.calls_per_run, inputTokensPerCall: P.input_tokens_per_call, outputTokensPerCall: P.output_tokens_per_call });
      lines.push(`${model} (router): ${pending.length} runs pending of ${items.filter((i) => i.model === model).length}; expected ~${calls} calls (worst case ${worst}); ~${Math.round(est.inputTokens / 1000)}k input + ~${Math.round(est.outputTokens / 1000)}k output tokens; planning estimate ${est.usd.toFixed(4)} USD (hard cap and ledger: docs/ROUTER.md)`);
      totalCalls += calls;
      routerUsd += est.usd;
      continue;
    }
    const lim = limitsFor(model);
    const usable = Math.max(0, Math.floor(lim.rpd * PROTOCOL.stop_fraction) - counter.count(model));
    totalCalls += calls;
    lines.push(`${model}: ${pending.length} runs pending of ${items.filter((i) => i.model === model).length}; expected ~${calls} calls (worst case ${worst}); `
      + `~${Math.round((calls * P.input_tokens_per_call) / 1000)}k input + ~${Math.round((calls * P.output_tokens_per_call) / 1000)}k output tokens; `
      + `calls usable today ${usable} (stop at ${Math.round(PROTOCOL.stop_fraction * 100)}% of ${lim.rpd}/day; already used ${counter.count(model)}) -> about ${usable > 0 ? Math.ceil(calls / usable) : 'many'} quota day(s) at the expected rate`);
  }
  const judgeCalls = {};
  for (const model of models) {
    const pending = items.filter((i) => i.model === model && !done.has(i.key)).length;
    const judge = PROTOCOL.judges[model];
    judgeCalls[judge] = (judgeCalls[judge] || 0) + pending * 3; // upper bound: every run claims done; variants A, B, INJ
  }
  lines.push('', 'judge calls (upper bound, every pending run claims done, three variants each):');
  for (const [judge, n] of Object.entries(judgeCalls)) {
    if (isRouterModel(judge)) {
      const est = estimateModelCost(judge, { runs: n, callsPerRun: 1, inputTokensPerCall: P.judge_input_tokens, outputTokensPerCall: P.judge_output_tokens });
      routerUsd += est.usd;
      lines.push(`  ${judge} (router): up to ${n} calls, planning estimate ${est.usd.toFixed(4)} USD`);
    } else lines.push(`  ${judge}: up to ${n} calls (limit ${limitsFor(judge).rpd}/day, ${limitsFor(judge).tpm} tokens/minute)`);
  }
  if (models.some(isRouterModel)) lines.push('', `router spend, planning estimate (agents + judge): ${routerUsd.toFixed(4)} USD against the ${DEFAULT_CAP_USD.toFixed(2)} USD hard cap (margin ${(DEFAULT_CAP_USD - routerUsd).toFixed(4)} USD); the ledger stops the run at the cap whatever this estimate says`);
  lines.push('', `quota resets at ${istString(nextPacificReset(now))}`, `expected agent calls in total: ~${totalCalls} (planning assumption ${P.calls_per_run} calls per run; the report shows the measured value)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- one episode

function readTranscript(file) {
  try { return readJsonl(file); } catch (_error) { return []; }
}

function testUse(transcript) {
  const runs = transcript.filter((e) => e.role === 'tool' && e.action === 'run_tests');
  const last = runs[runs.length - 1];
  return { ran_tests: runs.length, last_test_passed: last ? last.ok && /^exit code: 0$/m.test(last.text) : null, last_test_text: last ? last.text : null };
}

// The tool message is "TOOL RESULT ... header\n```\nbody\n```"; the judge gets the body only.
function unfenceToolText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.slice(2, -1).join('\n');
}

async function measureWorkspace(task, workspace, sandbox) {
  const gate = await runHiddenGate({ task, workspace, suite: 'gate' });
  const audit = await runHiddenGate({ task, workspace, suite: 'audit' });
  const v = await sandbox({ workspace, argv: task.meta.visible_test_argv, timeoutMs: PROTOCOL.test_timeout_ms, mode: 'copy' });
  const visible = v.spawnError ? 'error' : v.exitCode === 0 && !v.timedOut ? 'pass' : 'fail';
  return { gate, audit, visible };
}

async function runEpisode(ctx, item) {
  const task = ctx.tasks.get(item.task);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-ab-'));
  try {
    const llm = ctx.llmFor(item);
    const worker = new AgentWorker({ baseDir, llm, model: item.model, tasks: { [task.id]: task }, sandbox: ctx.sandbox, testTimeoutMs: PROTOCOL.test_timeout_ms, loop: { ...PROTOCOL.agent } });
    const spec = buildAgentRunSpec({ runId: 'r', tasks: [task], gateScript: path.join(ROOT, 'scripts', 'agent-gate.js'), deadlineMs: PROTOCOL.wall_clock_ms, gateTimeoutMs: PROTOCOL.gate_timeout_ms });
    const engine = new Engine(spec, { worker, log: new MemoryRunLog(), workDirFor: (a) => worker.workDirFor(a) });
    const started = Date.now();
    const report = await engine.run();
    const wallMs = Date.now() - started;
    const attemptId = `${task.id}.1`;
    const attemptDir = path.join(baseDir, 'r', attemptId);
    let summary = worker.results.get(attemptId);
    for (let i = 0; !summary && i < 40; i++) { await sleep(150); summary = worker.results.get(attemptId); }
    if (!summary) return { incomplete: 'no_result', detail: 'the worker never reported (engine deadline)' };
    if (summary.outcome === 'quota_exhausted') return { incomplete: 'quota', detail: summary.error && summary.error.message };
    if (summary.outcome === 'llm_error') {
      const failures = ctx.events.filter((e) => e.type === 'llm_error' && e.run === item.key).length + 1;
      ctx.logEvent({ type: 'llm_error', run: item.key, code: summary.error && summary.error.code, message: summary.error && summary.error.message });
      // A provider outage (overloaded, 5xx, network, rate limit) says nothing about the agent: the run stays incomplete and is
      // retried on a later invocation, however often. Only deterministic API failures (4xx, malformed replies) are final after 3 attempts.
      const transient = summary.error && TRANSIENT_LLM_CODES.has(summary.error.code);
      if (transient || failures < PROTOCOL.max_attempts_per_run) return { incomplete: transient ? 'llm_unavailable' : 'llm_error', detail: summary.error && summary.error.message };
    }
    if (summary.error && summary.error.code === 'CASSETTE_MISS') return { incomplete: 'cassette_miss', detail: summary.error.message };

    const workspace = path.join(attemptDir, 'workspace');
    const measured = await measureWorkspace(task, workspace, ctx.sandbox);
    if (measured.gate.status === 'error' || measured.audit.status === 'error' || measured.visible === 'error') {
      return { incomplete: 'sandbox', detail: [measured.gate, measured.audit].filter((r) => r.status === 'error').map((r) => `${r.code} ${r.detail}`).join('; ') || 'visible tests could not run' };
    }
    const transcript = readTranscript(path.join(attemptDir, 'transcript.jsonl'));
    const use = testUse(transcript);
    let engineGate = null;
    try { engineGate = JSON.parse(fs.readFileSync(path.join(attemptDir, 'gate-result.json'), 'utf8')); } catch (_error) { /* the engine only gates "done" claims */ }
    const engineTask = report.tasks[task.id];
    const claimedDone = summary.outcome === 'finished' && summary.claim === 'done';
    const record = {
      schema: 1, key: item.key, stage: ctx.stage, model: item.model, task: item.task, repeat: item.repeat,
      claim: summary.outcome === 'finished' ? summary.claim : null,
      note: summary.outcome === 'finished' ? summary.note : null,
      agent_outcome: summary.outcome === 'aborted' ? 'wall_clock' : summary.outcome,
      steps: summary.steps, protocol_errors: summary.protocolErrors, usage: summary.usage,
      ran_tests: use.ran_tests, last_test_passed: use.last_test_passed,
      visible_at_finish: measured.visible,
      gate: measured.gate, audit: measured.audit,
      engine: { status: engineTask.status, code: engineTask.code },
      gate_consistent: !claimedDone || (engineGate && engineGate.status === 'error') ? null : (engineTask.status === 'succeeded') === (measured.gate.status === 'pass'),
      wall_ms: wallMs, quota_day: pacificDay(Date.now()),
    };
    if (summary.error) record.error = summary.error;

    const dataDir = path.join(ctx.dir, 'run-data', item.model, `${item.task}.${item.repeat}`);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dataDir, 'outputs'), { recursive: true });
    fs.copyFileSync(path.join(attemptDir, 'transcript.jsonl'), path.join(dataDir, 'transcript.jsonl'));
    for (const name of task.meta.outputs) {
      const src = path.join(workspace, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, 'outputs', name));
    }
    fs.writeFileSync(path.join(dataDir, 'measurements.json'), `${JSON.stringify({ gate: measured.gate, audit: measured.audit, visible: measured.visible, engine_gate_result: engineGate }, null, 1)}\n`);
    return { record };
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- judge phase

function loadRunArtifacts(dir, task, record) {
  const dataDir = path.join(dir, 'run-data', record.model, `${record.task}.${record.repeat}`);
  const outputs = task.meta.outputs.map((name) => {
    const file = path.join(dataDir, 'outputs', name);
    return { name, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
  });
  const use = testUse(readTranscript(path.join(dataDir, 'transcript.jsonl')));
  return { outputs, lastTestOutput: unfenceToolText(use.last_test_text) };
}

async function judgePhase(ctx, runs, judgments, spotMax) {
  const have = new Set(judgments.map((j) => `${j.run}|${j.variant}`));
  const doneRuns = runs.filter((r) => r.claim === 'done');
  const jobs = new Map(); // judge model -> [{ record, variant }]
  const add = (model, record, variant) => { if (!have.has(`${record.key}|${variant}`)) { if (!jobs.has(model)) jobs.set(model, []); jobs.get(model).push({ record, variant }); } };
  for (const r of doneRuns) for (const variant of ['A', 'B', 'INJ']) add(PROTOCOL.judges[r.model], r, variant);
  const spotOrder = [...doneRuns].sort((a, b) => hash32(`spot|${a.key}`) - hash32(`spot|${b.key}`)).slice(0, spotMax);
  for (const r of spotOrder) add(PROTOCOL.spot_judge, r, 'SPOT');

  const summary = {};
  await Promise.all([...jobs.entries()].map(async ([model, list]) => {
    const stat = { judged: 0, stopped: null, errors: 0 };
    let consecutiveErrors = 0;
    summary[model] = stat;
    const stopAt = stopAtFor(model, PROTOCOL.stop_fraction);
    const queue = list.slice();
    const lane = async () => {
      for (;;) {
        if (stat.stopped) return;
        if (ctx.counter && ctx.live && ctx.counter.count(model) >= stopAt) { stat.stopped = 'quota'; return; }
        const next = queue.shift();
        if (!next) return;
        const { record, variant } = next;
        const task = ctx.tasks.get(record.task);
        const art = loadRunArtifacts(ctx.dir, task, record);
        const request = judgeLib.buildJudgeRequest({ prompt: task.prompt, outputs: art.outputs, variant, lastTestOutput: art.lastTestOutput });
        try {
          const verdict = await judgeLib.judge({ llm: ctx.judgeLlmFor(model, record), model, request, ...PROTOCOL.judge });
          appendJsonl(path.join(ctx.dir, 'judgments.jsonl'), { run: record.key, variant, judge_model: model, verdict: verdict.verdict, reason: verdict.reason, finishReason: verdict.finishReason, usage: verdict.usage });
          stat.judged++;
          consecutiveErrors = 0;
        } catch (error) {
          if (error instanceof QuotaExhaustedError) { stat.stopped = 'quota'; return; }
          stat.errors++;
          const failures = ctx.events.filter((e) => e.type === 'judge_error' && e.run === record.key && e.variant === variant).length + 1;
          ctx.logEvent({ type: 'judge_error', run: record.key, variant, code: error.code, message: redactSecrets(String(error.message)).slice(0, 200) });
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_UNAVAILABLE) { stat.stopped = 'api_unavailable'; return; }
          if (failures >= PROTOCOL.max_attempts_per_run && !TRANSIENT_LLM_CODES.has(error.code)) {
            appendJsonl(path.join(ctx.dir, 'judgments.jsonl'), { run: record.key, variant, judge_model: model, verdict: 'invalid', reason: `judge call failed ${failures} times (${error.code || 'error'})`, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } });
          }
          if (error.code === 'CASSETTE_MISS') { stat.stopped = 'cassette_miss'; return; }
        }
      }
    };
    await Promise.all(Array.from({ length: PROTOCOL.concurrency[model] || 1 }, lane));
  }));
  return summary;
}

// ---------------------------------------------------------------- the bench

/**
 * options: { stage, models, tasks (ids) , limit, dryRun, replay, judge, judgeOnly, spotMax, root, taskDirs, makeLlm, makeJudgeLlm, out, env, now }
 * Returns { exitCode, summary }. makeLlm / makeJudgeLlm exist for tests (a scripted model instead of the Gemini API).
 */
async function runBench(options) {
  const root = options.root || ROOT;
  const out = options.out || ((line) => process.stdout.write(`${line}\n`));
  const env = options.env || process.env;
  const stage = options.stage;
  if (stage !== 'dev' && stage !== 'final') throw new Error('--stage must be dev or final');
  const replay = Boolean(options.replay);
  const models = options.models || [...(options.router ? PROTOCOL.router_models : PROTOCOL.models)];
  for (const m of models) if (!PROTOCOL.models.includes(m) && !isRouterAgentModel(m)) throw new Error(`model ${m} is not in the protocol (${[...PROTOCOL.models, ...PROTOCOL.router_models].join(', ')}; optional: google/gemini-3.8-flash)`);
  const repeats = options.repeats || PROTOCOL.repeats[stage];
  if (options.repeats && stage === 'final') throw new Error('the final stage always uses the protocol repeats');
  const tasks = stageTasks(stage, root, options.taskDirs);
  const taskIds = options.tasks ? options.tasks : [...tasks.keys()].sort();
  for (const t of taskIds) if (!tasks.has(t)) throw new Error(`task ${t} is not in the ${stage} split`);
  const items = planRuns({ stage, models, taskIds, repeats });
  const dir = path.join(root, 'results', 'agent-claims', replay ? `${stage}-replay` : stage);
  const liveDir = path.join(root, 'results', 'agent-claims', stage);
  const counter = new DailyCounter();
  const now = options.now || Date.now();

  // Provenance first, before any file is written.
  const guard = stage === 'final' && !options.dryRun && !options.skipGuard ? finalStageGuard(root) : null;
  const gitState = gitInfo(root);
  const doneRuns = readJsonl(path.join(dir, 'runs.jsonl'));
  const done = new Set(doneRuns.map((r) => r.key));
  const events = readJsonl(path.join(dir, 'events.jsonl'));

  if (options.dryRun) {
    out(dryRunReport({ stage, models, items, done, counter, root, now }));
    return { exitCode: 0, summary: { dry_run: true } };
  }

  const live = !replay && !options.makeLlm;
  if (live) {
    if (env.WARRANT_LIVE !== '1') throw new Error('live model calls are off: set WARRANT_LIVE=1 (this is the only place that does)');
    // fail early, naming where each key is expected, without printing it
    if (models.some((m) => !isRouterModel(m))) loadApiKey(env);
    if (models.some(isRouterModel)) loadRouterKey(env);
  }
  const docker = options.sandbox ? { available: true } : dockerStatus();
  if (!docker.available) throw new Error(`Docker is required: ${docker.reason}`);
  // A previous run that was killed hard can leave containers behind (each also has a deadline of its own inside); remove the old ones.
  if (!options.sandbox) {
    const swept = sweepStale();
    if (swept.removed && swept.removed.length) out(`removed ${swept.removed.length} stale warrant container(s) from an earlier run`);
  }

  const taskHashes = Object.fromEntries([...tasks.entries()].map(([id, t]) => [id, treeHash(t.dir)]));
  const metaFile = path.join(dir, 'meta.json');
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (stage === 'final' && !replay && guard && meta.protocol && meta.protocol.sha256 !== guard.protocol_sha256) throw new Error('the protocol changed since this results directory was started; refusing to mix runs');
    for (const id of taskIds) if (meta.task_hashes && meta.task_hashes[id] && meta.task_hashes[id] !== taskHashes[id]) throw new Error(`task ${id} changed since this results directory was started; refusing to mix runs`);
  } else {
    const image = options.sandbox ? { image: null, id: null, digest: null } : imageInfo();
    writeFileAtomic(metaFile, `${JSON.stringify({
      stage, replay, protocol: { file: PROTOCOL_FILE, ...(guard ? { commit: guard.protocol_commit, sha256: guard.protocol_sha256 } : { commit: null, sha256: null }) },
      git: gitState, settings: PROTOCOL, node: process.version, docker_image_id: image.id, docker_image: image, gate: { version: GATE_VERSION, manifest_sha256: fileSha256(GATE_MANIFEST) }, task_hashes: taskHashes,
    }, null, 2)}\n`);
  }
  // The results directory is filled by several invocations (one per model or quota day); the plan is the union of all of them, so the
  // report compares what was recorded against everything planned and not only against the latest invocation.
  const planFile = path.join(dir, 'plan.json');
  const earlierPlan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : null;
  const plan = mergePlan(earlierPlan, { stage, models, tasks: taskIds, repeats, keys: items.map((i) => i.key) });
  writeFileAtomic(planFile, `${JSON.stringify(plan, null, 1)}
`);
  appendJsonl(path.join(dir, 'sessions.jsonl'), { at: new Date(now).toISOString(), git: gitState, argv: { models, tasks: options.tasks || null, limit: options.limit || null, replay, judge: options.judge !== false }, protocol_commit: guard ? guard.protocol_commit : null });

  const cassetteRoot = path.join(root, 'bench', 'agent-claims', 'cassettes', stage);
  const clients = new Map();
  const geminiFor = (model) => {
    if (!clients.has(model)) {
      clients.set(model, new GeminiClient({
        env, counter, requestTimeoutMs: PROTOCOL.request_timeout_ms,
        onEvent: (e) => { if (e.type !== 'ok' || e.attempt > 0 || e.ms > 30_000) ctx.logEvent({ type: 'api', ...e }); },
      }));
    }
    return clients.get(model);
  };
  // One router client (and so one ledger and one concurrency gate) for every router model of this process.
  let routerClient = null;
  const routerFor = () => {
    if (!routerClient) {
      routerClient = new OpenAICompatClient({
        env, requestTimeoutMs: PROTOCOL.request_timeout_ms,
        budget: new RouterBudget({ env, onWarning: (message) => ctx.logEvent({ type: 'router_budget_warning', message }) }),
        onEvent: (e) => { if (e.type !== 'ok' || e.attempt > 0 || e.ms > 30_000) ctx.logEvent({ type: 'api', ...e }); },
      });
    }
    return routerClient;
  };
  const liveFor = (model) => (isRouterModel(model) ? routerFor() : geminiFor(model));
  const cassetteFor = (file, model) => {
    if (replay) return new CassetteClient({ file, mode: 'replay', storeRequest: false });
    return new CassetteClient({ file, mode: 'replay-then-live', storeRequest: false, inner: new QuotaGuard({ inner: liveFor(model), counter, fraction: PROTOCOL.hard_stop_fraction }) });
  };
  const ctx = {
    stage, dir, tasks, counter, events, live,
    sandbox: options.sandbox || makeSandbox(2),
    logEvent: (e) => { const entry = { at: new Date().toISOString(), ...e }; events.push(entry); appendJsonl(path.join(dir, 'events.jsonl'), entry); },
    llmFor: (item) => (options.makeLlm ? options.makeLlm(item) : cassetteFor(path.join(cassetteRoot, item.model, `${item.task}.${item.repeat}.jsonl`), item.model)),
    judgeLlmFor: (judgeModel, record) => (options.makeJudgeLlm ? options.makeJudgeLlm(judgeModel, record) : cassetteFor(path.join(cassetteRoot, 'judge', judgeModel, `${record.model}.${record.task}.${record.repeat}.jsonl`), judgeModel)),
  };

  const status = {};
  const record = (r) => { appendJsonl(path.join(dir, 'runs.jsonl'), r); done.add(r.key); doneRuns.push(r); };

  if (!options.judgeOnly) {
    await Promise.all(models.map(async (model) => {
      const stat = { recorded: 0, incomplete: 0, stopped: null };
      status[model] = stat;
      const stopAt = stopAtFor(model, PROTOCOL.stop_fraction);
      const queue = items.filter((i) => i.model === model && !done.has(i.key));
      let started = 0;
      let unavailable = 0;
      const lane = async () => {
        for (;;) {
          if (stat.stopped) return;
          if (options.limit && started >= options.limit) { stat.stopped = 'limit'; return; }
          if (live && counter.count(model) >= stopAt) { stat.stopped = 'quota'; return; }
          const item = queue.shift();
          if (!item) return;
          started++;
          const t0 = Date.now();
          let result;
          try { result = await runEpisode(ctx, item); } catch (error) { result = { incomplete: 'harness_error', detail: redactSecrets(String(error && error.stack ? error.stack : error)).slice(0, 400) }; }
          if (result.record) {
            record(result.record);
            stat.recorded++;
            unavailable = 0;
            out(`${model} ${item.task}#${item.repeat}: ${result.record.claim || result.record.agent_outcome} -> gate ${result.record.gate.status}, audit ${result.record.audit.status}, visible ${result.record.visible_at_finish}, ${result.record.steps} steps (${Math.round((Date.now() - t0) / 1000)}s)`);
          } else {
            stat.incomplete++;
            ctx.logEvent({ type: 'incomplete', run: item.key, reason: result.incomplete, detail: result.detail });
            out(`${model} ${item.task}#${item.repeat}: INCOMPLETE (${result.incomplete}) ${result.detail || ''}`);
            if (result.incomplete === 'quota' || result.incomplete === 'harness_error' || result.incomplete === 'cassette_miss') stat.stopped = result.incomplete;
            // a model that keeps failing to answer is left alone for this invocation instead of burning its daily requests
            unavailable = result.incomplete === 'llm_unavailable' ? unavailable + 1 : 0;
            if (unavailable >= MAX_CONSECUTIVE_UNAVAILABLE) stat.stopped = 'api_unavailable';
          }
        }
      };
      await Promise.all(Array.from({ length: options.concurrency || PROTOCOL.concurrency[model] || 1 }, lane));
    }));
  }

  let judging = null;
  if (options.judge !== false) {
    judging = await judgePhase(ctx, doneRuns.filter((r) => items.some((i) => i.key === r.key)), readJsonl(path.join(dir, 'judgments.jsonl')), options.spotMax ?? (stage === 'dev' ? 2 : 10_000));
  }

  const remaining = items.filter((i) => !done.has(i.key));
  const summary = { stage, replay, dir, recorded_total: done.size, planned: items.length, remaining: remaining.length, per_model: status, judging };
  let exitCode = 0;
  if (replay) {
    const liveRuns = new Map(readJsonl(path.join(liveDir, 'runs.jsonl')).map((r) => [r.key, r]));
    const same = (a, b) => a.claim === b.claim && a.agent_outcome === b.agent_outcome && a.steps === b.steps && a.gate.status === b.gate.status && a.audit.status === b.audit.status && a.visible_at_finish === b.visible_at_finish && JSON.stringify(a.usage) === JSON.stringify(b.usage);
    const compared = doneRuns.filter((r) => liveRuns.has(r.key));
    const mismatches = compared.filter((r) => !same(r, liveRuns.get(r.key))).map((r) => r.key);
    summary.replay_check = { compared: compared.length, mismatches };
    if (mismatches.length) exitCode = 1;
  }
  out('');
  out(`recorded ${done.size}/${items.length} runs; ${remaining.length} remaining`);
  for (const [model, s] of Object.entries(status)) out(`  ${model}: +${s.recorded} recorded, ${s.incomplete} incomplete${s.stopped ? `, stopped (${s.stopped})` : ''}; calls used today ${counter.count(model)}/${limitsFor(model).rpd}`);
  if (judging) for (const [model, s] of Object.entries(judging)) out(`  judge ${model}: +${s.judged}${s.errors ? `, ${s.errors} errors` : ''}${s.stopped ? `, stopped (${s.stopped})` : ''}`);
  if (Object.values(status).some((s) => s.stopped === 'quota') || (judging && Object.values(judging).some((s) => s.stopped === 'quota'))) {
    out(`the daily quota is nearly used; resume after the reset at ${istString(nextPacificReset(now))} with the same command (finished runs are skipped, interrupted ones continue from their cassette)`);
  }
  if (summary.replay_check) out(`replay check: ${summary.replay_check.compared} compared with the live results, ${summary.replay_check.mismatches.length} mismatch(es)`);
  return { exitCode, summary };
}

// The plan of a results directory is the union of the plans of every invocation that wrote to it (same stage and repeats).
function mergePlan(earlier, next) {
  if (!earlier || earlier.stage !== next.stage || earlier.repeats !== next.repeats) return next;
  const union = (x, y) => [...x, ...y.filter((v) => !x.includes(v))];
  return { stage: next.stage, models: union(earlier.models, next.models), tasks: union(earlier.tasks, next.tasks), repeats: next.repeats, keys: union(earlier.keys, next.keys) };
}

module.exports = Object.freeze({
  PROTOCOL, PROTOCOL_FILE, QuotaGuard, finalStageGuard, gitInfo, makeSandbox, mergePlan, nextPacificReset, planRuns, readJsonl, runBench, testUse, treeHash, unfenceToolText,
});
