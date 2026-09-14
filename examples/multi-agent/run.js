#!/usr/bin/env node
'use strict';

// Multi-agent demo: a planner agent splits a list of bugs into subtasks, worker agents fix them in parallel under
// warrant, and host-owned hidden test suites decide what counts as done, with and without gating.
//
//   node examples/multi-agent/run.js                       replay the recorded scripted session ("mixed"), offline
//   node examples/multi-agent/run.js --scenario overconfident|clean
//   node examples/multi-agent/run.js --mode gated|ungated|both --out <dir> --json
//   node examples/multi-agent/run.js --all --export examples/multi-agent/expected    refresh the checked-in sample output
//   node examples/multi-agent/run.js --record-scripted     regenerate the scripted cassette(s) offline (FakeLlm, no network)
//   WARRANT_LIVE=1 node examples/multi-agent/run.js --live --model gemini-3.5-flash-lite --max-calls 100   (spends API quota)
//   node examples/multi-agent/run.js --scenario live --model gemini-3.5-flash-lite      replay that recording, offline
//
// Needs Docker with the node:22-alpine image: model-written code only ever runs in the sandbox.
// docs/MULTI_AGENT_DEMO.md explains the design, the safety invariant and the exact live commands.

const fs = require('node:fs');
const path = require('node:path');
const { CassetteClient, GeminiClient, redactSecrets } = require('../../src/llm');
const { dockerStatus } = require('../../src/sandbox/docker');
const { assertLiveAllowed } = require('../../src/demo/live');
const { loadCatalogue, reportProblems, runScenario } = require('../../src/demo');
const { SCENARIOS, createScriptedLlm } = require('./scripted');

const ROOT = path.resolve(__dirname, '..', '..');
const CASSETTES = path.join(__dirname, 'cassettes');
const SCRIPTED_MODEL = 'scripted-agents';
const LIVE_MODEL = 'gemini-3.5-flash-lite';
const FLAGS = { '--scenario': 'scenario', '--mode': 'mode', '--out': 'out', '--cassette': 'cassette', '--model': 'model', '--max-calls': 'maxCalls', '--export': 'exportDir' };
const SWITCHES = { '--json': 'json', '--record-scripted': 'recordScripted', '--live': 'live', '--all': 'all', '--keep-work': 'keepWork' };

function parseArgs(argv) {
  const args = { scenario: 'mixed', mode: 'both', maxCalls: 100 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (Object.hasOwn(SWITCHES, arg)) args[SWITCHES[arg]] = true;
    else if (Object.hasOwn(FLAGS, arg)) {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
      args[FLAGS[arg]] = argv[++i];
    } else throw new Error(`unknown option ${arg}`);
  }
  args.maxCalls = Number(args.maxCalls);
  if (!Number.isInteger(args.maxCalls) || args.maxCalls < 1) throw new Error('--max-calls must be a positive integer');
  if (!['both', 'gated', 'ungated'].includes(args.mode)) throw new Error('--mode must be both, gated or ungated');
  if (!args.live && args.scenario === 'live' && !args.model) throw new Error('replaying a live recording needs --model <the model it was recorded with>');
  if (!args.live && args.scenario !== 'live' && !Object.hasOwn(SCENARIOS, args.scenario)) throw new Error(`--scenario must be one of ${Object.keys(SCENARIOS).join(', ')}`);
  return args;
}

// Lines sorted by (key, n): the cassette's bytes then do not depend on which parallel worker called first.
function sortCassette(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const keyed = lines.map((line) => { const e = JSON.parse(line); return { line, key: e.key, n: e.n }; });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.n - b.n));
  fs.writeFileSync(file, `${keyed.map((k) => k.line).join('\n')}\n`);
}

// The checked-in sample output: reports, plan, specs and run logs (as .run.jsonl, so a *.log ignore rule cannot hide them).
function exportSample(outDir, destDir, report) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of ['report.json', 'report.md', 'plan.json']) fs.copyFileSync(path.join(outDir, file), path.join(destDir, file));
  for (const mode of Object.keys(report.modes)) {
    fs.copyFileSync(path.join(outDir, mode, 'spec.json'), path.join(destDir, `${mode}.spec.json`));
    fs.copyFileSync(path.join(outDir, mode, 'run.log'), path.join(destDir, `${mode}.run.jsonl`));
  }
}

async function runOne(args, scenario, catalogue) {
  const outDir = path.resolve(ROOT, args.out || path.join('.warrant', 'multi-agent'), scenario);
  const modes = args.mode === 'both' ? ['gated', 'ungated'] : [args.mode];
  let makeLlm;
  let model = SCRIPTED_MODEL;
  let cassette;
  let gemini = null;

  if (args.live) {
    assertLiveAllowed();
    model = args.model || LIVE_MODEL;
    cassette = path.resolve(args.cassette || path.join(CASSETTES, `live-${model}.jsonl`));
    if (fs.existsSync(cassette)) throw new Error(`${cassette} already exists; refusing to overwrite a recording (delete it to re-record)`);
    gemini = new GeminiClient({ maxCalls: args.maxCalls });
    // The planner and the gated run call the model; the ungated run only replays what the gated run recorded.
    makeLlm = (phase) => (phase === 'ungated'
      ? new CassetteClient({ file: cassette, mode: 'replay' })
      : new CassetteClient({ file: cassette, mode: 'record', inner: gemini, storeRequest: false }));
  } else if (args.recordScripted) {
    cassette = path.resolve(args.cassette || path.join(CASSETTES, `${scenario}.jsonl`));
    fs.rmSync(cassette, { force: true });
    const inner = createScriptedLlm(catalogue, scenario);
    makeLlm = (phase) => (phase === 'ungated'
      ? new CassetteClient({ file: cassette, mode: 'replay' })
      : new CassetteClient({ file: cassette, mode: 'record', inner, storeRequest: false }));
  } else {
    // replaying a recording made with a real model (--scenario live --model <id>), or the scripted cast
    if (scenario === 'live') model = args.model;
    cassette = path.resolve(args.cassette || path.join(CASSETTES, scenario === 'live' ? `live-${model}.jsonl` : `${scenario}.jsonl`));
    if (!fs.existsSync(cassette)) throw new Error(`no cassette at ${cassette}; run with --record-scripted to create it (offline, no API calls)`);
    makeLlm = () => new CassetteClient({ file: cassette, mode: 'replay' });
  }

  const report = await runScenario({ scenario, catalogue, model, makeLlm, outDir, modes, keepWork: Boolean(args.keepWork) });
  if ((args.live || args.recordScripted) && fs.existsSync(cassette)) sortCassette(cassette);
  return { report, outDir, cassette, gemini };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.live) assertLiveAllowed(); // refuse before anything else, including the Docker check
  const docker = dockerStatus();
  if (!docker.available) throw new Error(`Docker is required: ${docker.reason}`);
  const catalogue = loadCatalogue();
  const scenarios = args.live ? ['live'] : args.all ? Object.keys(SCENARIOS) : [args.scenario];
  let code = 0;
  for (const scenario of scenarios) {
    const { report, outDir, gemini } = await runOne(args, scenario, catalogue);
    const problems = reportProblems(report);
    if (args.exportDir) exportSample(outDir, path.resolve(ROOT, args.exportDir, scenario), report);
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`${fs.readFileSync(path.join(outDir, 'report.md'), 'utf8')}\n`);
      process.stdout.write(`output: ${path.relative(ROOT, outDir)}  (report.json, report.md, plan.json; gated/ and ungated/ with run.log, spec.json and per-attempt transcripts)\n`);
      if (gemini) process.stdout.write(`live HTTP calls made: ${gemini.httpCalls}\n`);
      if (problems.length) process.stdout.write(`PROBLEMS:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    }
    if (problems.length) code = 1;
  }
  return code;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`multi-agent demo: ${redactSecrets(error && error.message ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
