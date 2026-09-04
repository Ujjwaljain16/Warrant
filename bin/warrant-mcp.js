#!/usr/bin/env node
'use strict';

// MCP server (stdio). stdout carries protocol messages only; every diagnostic goes to stderr.
//   node bin/warrant-mcp.js --spec-dir <dir of approved specs> --state-dir <dir for runs and logs>
const path = require('node:path');
const { LIMITS } = require('../src/mcp/limits');
const { serveStdio } = require('../src/mcp/stdio');

const USAGE = `warrant-mcp - MCP server that runs human-approved warrant specs by name

usage: warrant-mcp --spec-dir <dir> --state-dir <dir> [--max-run-ms <ms>] [--sync-wait-ms <ms>]

  --spec-dir     directory of approved specs, <name>.json (or env WARRANT_MCP_SPEC_DIR). Specs run commands as YOU:
                 only put specs there that you would run yourself.
  --state-dir    where runs, logs and reports are written (or env WARRANT_MCP_STATE_DIR)
  --max-run-ms   hard wall-clock limit of one run, default ${LIMITS.defaultMaxRunMs} (or env WARRANT_MCP_MAX_RUN_MS)
  --sync-wait-ms how long warrant_run waits for a run before returning "running", default ${LIMITS.defaultSyncWaitMs}`;

const VALUE_FLAGS = new Set(['--spec-dir', '--state-dir', '--max-run-ms', '--sync-wait-ms']);

function fail(message) {
  process.stderr.write(`warrant-mcp: ${message}\n\n${USAGE}\n`);
  process.exitCode = 2;
}

function intFlag(value, name, min, max) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function parse(argv, env) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!VALUE_FLAGS.has(arg)) throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    if (i + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
    if (Object.hasOwn(flags, arg)) throw new Error(`duplicate option ${arg}`);
    flags[arg] = argv[++i];
  }
  const specDir = flags['--spec-dir'] || env.WARRANT_MCP_SPEC_DIR;
  const stateDir = flags['--state-dir'] || env.WARRANT_MCP_STATE_DIR;
  if (!specDir) throw new Error('--spec-dir (or WARRANT_MCP_SPEC_DIR) is required');
  if (!stateDir) throw new Error('--state-dir (or WARRANT_MCP_STATE_DIR) is required');
  const maxRun = flags['--max-run-ms'] ?? env.WARRANT_MCP_MAX_RUN_MS;
  const syncWait = flags['--sync-wait-ms'];
  return {
    specDir: path.resolve(specDir),
    stateDir: path.resolve(stateDir),
    maxRunMs: maxRun === undefined ? LIMITS.defaultMaxRunMs : intFlag(maxRun, '--max-run-ms', 100, LIMITS.ceilingMaxRunMs),
    syncWaitMs: syncWait === undefined ? LIMITS.defaultSyncWaitMs : intFlag(syncWait, '--sync-wait-ms', 0, 10 * 60 * 1000),
  };
}

let options;
try { options = parse(process.argv.slice(2), process.env); } catch (error) { fail(error.message); }
if (options && options.help) {
  process.stderr.write(`${USAGE}\n`);
} else if (options) {
  try {
    const { done, shutdown } = serveStdio(options);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { shutdown(); });
    done.then(() => { process.exitCode = 0; });
  } catch (error) {
    fail(error.message);
  }
}
