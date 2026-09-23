#!/usr/bin/env node
'use strict';

// The agent-claims experiment runner (protocol: docs/AGENT_CLAIMS_PROTOCOL.md).
//
//   node scripts/agent-bench.js --stage dev|final [options]
//
//   --models a,b      subset of the protocol models (default: all three; with --router, the two router agents)
//   --router          use the third-party router arm (docs/ROUTER.md): hard spend cap ($0.40), needs the key in %USERPROFILE%\.warrant\closerouter.key
//   --tasks a,b       subset of the stage's tasks (default: all)
//   --limit N         stop each model after N episodes in this invocation (debugging)
//   --dry-run         print the planned work, expected calls and tokens, and quota days; make no call, write nothing
//   --replay          run offline from the committed cassettes only (results go to results/agent-claims/<stage>-replay)
//   --no-judge        skip the LLM-judge phase
//   --judge-only      only run the judge phase on already finished runs
//   --spot-max N      at most N strong-judge spot checks (default: 2 in dev, no cap beyond the daily quota in final)
//
// Live model calls need WARRANT_LIVE=1 and a key in GEMINI_API_KEY or %USERPROFILE%\.warrant\gemini.key (never printed).
// The run is resumable: finished runs are skipped, interrupted ones continue from their cassette, and it stops cleanly at
// 90% of every model's daily request limit. The final stage refuses to start unless docs/AGENT_CLAIMS_PROTOCOL.md and
// bench/agent-claims/tasks are committed and unmodified.

const { runBench } = require('../src/bench/agent-run');
const { redactSecrets } = require('../src/llm');

const FLAGS = { '--stage': 'value', '--models': 'value', '--tasks': 'value', '--limit': 'value', '--spot-max': 'value', '--dry-run': 'bool', '--router': 'bool', '--replay': 'bool', '--no-judge': 'bool', '--judge-only': 'bool' };

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const kind = FLAGS[argv[i]];
    if (!kind) throw new Error(`unknown option ${argv[i]}`);
    out[argv[i]] = kind === 'bool' ? true : argv[++i];
    if (kind === 'value' && out[argv[i - 1]] === undefined) throw new Error(`${argv[i - 1]} needs a value`);
  }
  return out;
}

function int(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

async function main(argv) {
  const flags = parse(argv);
  if (!flags['--stage']) throw new Error('--stage dev|final is required');
  const { exitCode } = await runBench({
    stage: flags['--stage'],
    models: flags['--models'] ? flags['--models'].split(',') : undefined,
    tasks: flags['--tasks'] ? flags['--tasks'].split(',') : undefined,
    limit: flags['--limit'] === undefined ? undefined : int(flags['--limit'], '--limit'),
    spotMax: flags['--spot-max'] === undefined ? undefined : int(flags['--spot-max'], '--spot-max'),
    dryRun: Boolean(flags['--dry-run']),
    replay: Boolean(flags['--replay']),
    router: Boolean(flags['--router']),
    judge: !flags['--no-judge'],
    judgeOnly: Boolean(flags['--judge-only']),
  });
  return exitCode;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`agent-bench: ${redactSecrets(error && error.message ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
