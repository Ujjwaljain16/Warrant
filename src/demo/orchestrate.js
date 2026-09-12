'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runHiddenGate } = require('../agent/gate');
const { specDigest } = require('../core/spec');
const { Engine } = require('../engine/engine');
const { auditLog } = require('../engine/replay');
const { FileRunLog } = require('../log/runlog');
const { runInSandbox } = require('../sandbox/docker');
const { INTEGRATE_ID } = require('./catalogue');
const { materializeTasks } = require('./materialize');
const { planWithRetry } = require('./plan');
const { HOST_POLICY, buildSpec } = require('./spec');
const { DemoWorker } = require('./worker');

const GATE_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'agent-gate.js');
const MODES = Object.freeze(['gated', 'ungated']);

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// The docker CLI occasionally fails for reasons that say nothing about the code under test (daemon hiccups under load).
// Such a run is reported by the sandbox as a spawnError; retrying it keeps a replay from diverging on a flake.
function resilientSandbox(run = runInSandbox, tries = 3) {
  return async (options) => {
    let result;
    for (let i = 0; i < tries; i++) {
      result = await run(options);
      if (!result.spawnError) return result;
    }
    return result;
  };
}

function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

// The hidden suites are the judge: the same suites the gate uses (gate), and the stricter superset used only to measure (audit).
async function judgeFiles({ task, files, suite, sandbox }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-demo-judge-'));
  try {
    writeFiles(workspace, files);
    const r = await runHiddenGate({ task, workspace, suite, run: sandbox });
    return { status: r.status, code: r.code, detail: r.detail || '' };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

// What is worth keeping from an attempt directory: the agent's transcript and result, and the gate's structured verdict.
function keepRecords(from, to) {
  if (!fs.existsSync(from)) return;
  for (const attempt of fs.readdirSync(from)) {
    for (const name of ['transcript.jsonl', 'agent-result.json', 'gate-result.json']) {
      const source = path.join(from, attempt, name);
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(path.join(to, attempt), { recursive: true });
      fs.copyFileSync(source, path.join(to, attempt, name));
    }
  }
}

/**
 * One full pass of one mode: build the spec from the (validated) plan, run it through the real Engine with the agents,
 * write run.log and spec.json, then judge what the mode accepted against the hidden suites it never saw.
 */
async function runMode({ mode, scenario, catalogue, plan, llm, model, outDir, policy, sandbox, keepWork = false }) {
  const modeDir = path.join(outDir, mode);
  fs.rmSync(modeDir, { recursive: true, force: true });
  fs.mkdirSync(modeDir, { recursive: true });
  // Task directories and agent workspaces (model-written code included) live in the OS temp directory, never in the repository.
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), `warrant-ma-${mode}-`));
  const { tasks, integrate, dirs } = materializeTasks({ catalogue, workDir: path.join(workRoot, 'tasks'), subtasks: plan.subtasks });
  const spec = buildSpec({ runId: `multi-agent-${scenario}-${mode}`, catalogue, subtaskIds: plan.subtasks.map((s) => s.id), mode, policy });
  fs.writeFileSync(path.join(modeDir, 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);

  const workerIds = spec.tasks.filter((t) => t.id !== INTEGRATE_ID).map((t) => t.id);
  const worker = new DemoWorker({
    baseDir: path.join(workRoot, 'attempts'), llm, model, tasks: tasks, integrate, catalogue,
    gateScript: mode === 'gated' ? GATE_SCRIPT : null, taskDirs: dirs, sandbox,
    loop: { maxSteps: policy.loopMaxSteps, maxOutputTokens: 2048 }, order: workerIds,
  });
  const log = new FileRunLog(path.join(modeDir, 'run.log'), { durable: false });
  // Log timestamps are the sequence position, not wall time, so the log depends only on what happened.
  const clock = { now: () => log.entries().length, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };
  let report;
  let violations;
  try {
    const engine = new Engine(spec, { worker, log, clock, workDirFor: (a) => worker.workDirFor(a), observer: worker.observer });
    report = await engine.run();
    violations = auditLog(spec, log.entries());
  } finally {
    log.close();
  }

  // What this mode accepted: the artifacts of the attempt that settled each task as succeeded.
  const acceptedAttempt = {};
  for (const id of workerIds) if (report.tasks[id].status === 'succeeded') acceptedAttempt[id] = `${id}.${report.tasks[id].attempts}`;
  const acceptedIds = Object.keys(acceptedAttempt);

  const audit = {};
  for (const id of acceptedIds) {
    const files = worker.delivered.get(acceptedAttempt[id]) || {};
    audit[id] = (await judgeFiles({ task: tasks.get(id), files, suite: 'audit', sandbox })).status;
  }
  const shipped = worker.mergeFor(acceptedAttempt);
  const integration = await judgeFiles({ task: integrate, files: shipped, suite: 'gate', sandbox });

  const taskReports = {};
  for (const task of spec.tasks) {
    const rec = report.tasks[task.id];
    const attempts = [];
    for (let no = 1; no <= rec.attempts; no++) {
      const r = worker.results.get(`${task.id}.${no}`);
      if (r) attempts.push({ attempt: no, claim: r.claim, outcome: r.outcome, steps: r.steps });
    }
    taskReports[task.id] = {
      status: rec.status, code: rec.code, attempts: rec.attempts,
      verification: rec.verification ? { level: rec.verification.level, passed: rec.verification.passed, failed: rec.verification.failed } : null,
      agent: attempts,
    };
  }
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
  for (const r of worker.results.values()) { usage.calls += r.usage.calls; usage.input_tokens += r.usage.inputTokens; usage.output_tokens += r.usage.outputTokens; }

  keepRecords(path.join(workRoot, 'attempts', spec.run_id), path.join(modeDir, 'attempts'));
  if (keepWork) process.stderr.write(`kept the ${mode} work directory (task directories, agent workspaces): ${workRoot}\n`);
  else fs.rmSync(workRoot, { recursive: true, force: true });

  const falseAcceptances = acceptedIds.filter((id) => audit[id] !== 'pass');
  const reportedSuccess = report.status === 'succeeded';
  return {
    dir: modeDir,
    spec,
    summary: {
      run_status: report.status,
      spec_digest: specDigest(spec),
      log_entries: report.log_entries,
      log_head: report.log_head,
      invariant_violations: violations,
      engine_attempts: report.attempts,
      tasks: taskReports,
      accepted: acceptedIds,
      audit,
      false_acceptances: falseAcceptances,
      shipped_integration: integration,
      reported_success: reportedSuccess,
      false_success: reportedSuccess && integration.status !== 'pass',
      agent_usage: usage,
    },
  };
}

/**
 * The whole demo for one scenario: plan (validated by the host), then each requested mode. `makeLlm(phase)` is asked for
 * a fresh LlmClient for 'plan' and for each mode, so a cassette can be replayed independently by every phase.
 */
async function runScenario({ scenario, catalogue, model, makeLlm, outDir, modes = MODES, policy = HOST_POLICY, sandbox = resilientSandbox(), keepWork = false }) {
  fs.mkdirSync(outDir, { recursive: true });
  const planned = await planWithRetry({ llm: makeLlm('plan'), model, catalogue });
  const planReport = {
    accepted: planned.ok, rounds: planned.rounds,
    rejected: planned.rejected.map((r) => ({ round: r.round, reply_sha256: r.reply_sha256, errors: r.errors })),
    subtasks: planned.ok ? planned.subtasks : [],
    uncovered: planned.ok ? catalogue.bugIds.filter((id) => !planned.subtasks.some((s) => s.id === id)) : catalogue.bugIds,
  };
  if (planned.error) planReport.error = planned.error;
  fs.writeFileSync(path.join(outDir, 'plan.json'), `${JSON.stringify(planReport, null, 2)}\n`);
  const report = { demo: 'multi-agent', scenario, model, host_policy: { ...policy }, plan: planReport, modes: {}, comparison: [] };
  if (!planned.ok) {
    report.status = 'plan_rejected';
    finish(outDir, report);
    return report;
  }

  const results = {};
  for (const mode of modes) {
    results[mode] = await runMode({ mode, scenario, catalogue, plan: planned, llm: makeLlm(mode), model, outDir, policy, sandbox, keepWork });
    report.modes[mode] = results[mode].summary;
  }
  report.status = 'completed';
  report.comparison = compare(planned.subtasks.map((s) => s.id), report.modes);
  report.headline = headline(report.modes);
  finish(outDir, report);
  return report;
}

function compare(ids, modes) {
  const cell = (summary, id) => {
    if (!summary) return null;
    const t = summary.tasks[id];
    return { status: t.status, code: t.code, accepted: summary.accepted.includes(id), audit: summary.audit[id] || null };
  };
  return ids.map((id) => {
    const first = modes.ungated && modes.ungated.tasks[id].agent[0];
    const gatedFirst = modes.gated && modes.gated.tasks[id].agent[0];
    const lead = first || gatedFirst || null;
    return { id, agent_claim: lead ? lead.claim : null, agent_outcome: lead ? lead.outcome : null, ungated: cell(modes.ungated, id), gated: cell(modes.gated, id) };
  });
}

function headline(modes) {
  const pick = (m) => (m ? { accepted: m.accepted.length, false_acceptances: m.false_acceptances.length, reported_success: m.reported_success, false_success: m.false_success, shipped_integration: m.shipped_integration.status } : null);
  return { gated: pick(modes.gated), ungated: pick(modes.ungated) };
}

function finish(outDir, report) {
  const { toMarkdown } = require('./report');
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'report.md'), toMarkdown(report));
}

module.exports = Object.freeze({ GATE_SCRIPT, MODES, resilientSandbox, runMode, runScenario, sha256 });
