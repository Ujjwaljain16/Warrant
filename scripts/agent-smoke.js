#!/usr/bin/env node
'use strict';

// One agent episode on one toy task, through the real warrant engine, the Docker sandbox and the hidden-test gate.
//   WARRANT_LIVE=1 node scripts/agent-smoke.js --mode record --task slugify --model gemini-3.5-flash-lite --cassette bench/agent-claims/cassettes/smoke-slugify.jsonl --max-calls 15
//   node scripts/agent-smoke.js --mode replay --task slugify --cassette bench/agent-claims/cassettes/smoke-slugify.jsonl
// record: live calls (needs WARRANT_LIVE=1 and a key), every call appended to the cassette, hard call cap.
// replay: no network, no key; a request that was never recorded is a hard error.
// Prints one JSON summary line. The digests let a replay be compared byte-for-byte with the recording.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentWorker, buildAgentRunSpec, loadTask } = require('../src/agent');
const { Engine } = require('../src/engine/engine');
const { MemoryRunLog } = require('../src/log/runlog');
const { CassetteClient, GeminiClient, redactSecrets } = require('../src/llm');
const { dockerStatus } = require('../src/sandbox/docker');

const ROOT = path.resolve(__dirname, '..');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function parseArgs(argv) {
  const out = { mode: 'replay', task: 'slugify', model: 'gemini-3.5-flash-lite', maxCalls: 15, maxSteps: 10 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    out[key] = ['maxCalls', 'maxSteps'].includes(key) ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!out.cassette) out.cassette = path.join(ROOT, 'bench', 'agent-claims', 'cassettes', `smoke-${out.task}.jsonl`);
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const docker = dockerStatus();
  if (!docker.available) throw new Error(`Docker is required: ${docker.reason}`);
  const task = loadTask(path.join(ROOT, 'bench', 'agent-claims', 'toy', args.task));

  let llm;
  let gemini = null;
  if (args.mode === 'record') {
    if (process.env.WARRANT_LIVE !== '1') throw new Error('record mode makes live API calls: set WARRANT_LIVE=1');
    if (fs.existsSync(args.cassette)) throw new Error(`cassette ${args.cassette} already exists; delete it to re-record`);
    gemini = new GeminiClient({ maxCalls: args.maxCalls });
    llm = new CassetteClient({ file: args.cassette, mode: 'record', inner: gemini });
  } else if (args.mode === 'replay') {
    llm = new CassetteClient({ file: args.cassette, mode: 'replay' });
  } else {
    throw new Error('--mode must be record or replay');
  }

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-smoke-'));
  const worker = new AgentWorker({ baseDir, llm, model: args.model, tasks: { [task.id]: task }, loop: { maxSteps: args.maxSteps, maxOutputTokens: 2048 } });
  const spec = buildAgentRunSpec({ runId: 'run-smoke', tasks: [task], gateScript: path.join(ROOT, 'scripts', 'agent-gate.js'), deadlineMs: 900_000, gateTimeoutMs: 150_000 });
  const engine = new Engine(spec, { worker, log: new MemoryRunLog(), workDirFor: (a) => worker.workDirFor(a) });
  const report = await engine.run();

  const attemptDir = path.join(baseDir, 'run-smoke', `${task.id}.1`);
  const summary = worker.results.get(`${task.id}.1`) || null;
  const readIf = (f) => (fs.existsSync(path.join(attemptDir, f)) ? fs.readFileSync(path.join(attemptDir, f), 'utf8') : null);
  const output = readIf(path.join('workspace', task.meta.outputs[0]));
  const result = {
    mode: args.mode, task: task.id, model: args.model,
    engine_status: report.tasks[task.id].status, engine_code: report.tasks[task.id].code,
    agent_claim: summary && summary.claim, agent_outcome: summary && summary.outcome, steps: summary && summary.steps,
    usage: summary && summary.usage, gate: readIf('gate-result.json') ? JSON.parse(readIf('gate-result.json')) : null,
    model_calls: llm.stats, http_calls: gemini ? gemini.httpCalls : 0,
    transcript_sha256: sha(readIf('transcript.jsonl') || ''), output_sha256: output === null ? null : sha(output),
  };
  fs.rmSync(baseDir, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`agent-smoke failed: ${redactSecrets(error && error.message ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
