#!/usr/bin/env node
'use strict';

// Hidden-test gate for an agent attempt, used as the argv of a warrant `command` requirement:
//   node scripts/agent-gate.js <task-dir> [workspace-dir]       (cwd = the attempt directory; workspace defaults to ./workspace)
// Exit codes: 0 hidden tests passed, 1 they did not (or an output is missing), 2 the gate could not be evaluated.
// The structured result is also written to ./gate-result.json in the attempt directory.

const fs = require('node:fs');
const path = require('node:path');
const { runHiddenGate } = require('../src/agent/gate');
const { loadTask } = require('../src/agent/task');

async function main(argv) {
  if (argv.length < 1) {
    process.stderr.write('usage: agent-gate.js <task-dir> [workspace-dir]\n');
    return 2;
  }
  let result;
  try {
    const task = loadTask(argv[0]);
    result = await runHiddenGate({ task, workspace: path.resolve(argv[1] || 'workspace') });
  } catch (error) {
    result = { status: 'error', code: 'GATE_CRASHED', detail: String(error.message).slice(0, 200) };
  }
  try { fs.writeFileSync('gate-result.json', JSON.stringify(result)); } catch (_error) { /* best effort */ }
  process.stdout.write(`${result.status} ${result.code} ${result.detail || ''}\n`);
  return result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
