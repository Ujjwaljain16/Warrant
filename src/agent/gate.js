'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runInSandbox } = require('../sandbox/docker');
const { MAX_FILE_BYTES, loadTask, walkFiles } = require('./task');

// The hidden-test gate. It never trusts the agent's workspace as a whole: a fresh directory is assembled from
//   1. the pristine starting repo,
//   2. only the declared output files copied from the agent's workspace (regular files, no links),
//   3. the hidden tests,
// and the hidden tests run in the sandbox there. So the agent cannot pass by editing tests, adding files that shadow
// modules, or dropping a package.json; it can only pass by producing correct declared outputs.
function copyTree(from, to) {
  for (const f of walkFiles(from)) {
    if (f.symlink) throw new Error(`refusing to copy symbolic link ${f.rel}`);
    const target = path.join(to, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(f.full, target);
  }
}

// Containers run as an unprivileged user; on POSIX hosts the directory must be writable by it.
function openPermissions(dir) {
  if (process.platform === 'win32') return;
  fs.chmodSync(dir, 0o777);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) openPermissions(full); else fs.chmodSync(full, 0o666);
  }
}

function assembleGateDir(task, workspace, dest, suite = 'gate') {
  copyTree(task.repoDir, dest);
  const missing = [];
  for (const out of task.meta.outputs) {
    const src = path.join(workspace, out);
    let stat = null;
    try { stat = fs.lstatSync(src); } catch (_error) { /* missing */ }
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) { missing.push(out); continue; }
    fs.copyFileSync(src, path.join(dest, out));
  }
  copyTree(task.gateDir, dest);
  if (suite === 'audit') copyTree(task.auditDir, dest);
  openPermissions(dest);
  return missing;
}

// node --test with the TAP reporter ends with "# tests N / # pass N / # fail N".
function parseTap(stdout) {
  const num = (name) => {
    const m = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(stdout);
    return m ? Number(m[1]) : null;
  };
  return { tests: num('tests'), pass: num('pass'), fail: num('fail') };
}

/**
 * `suite` is 'gate' (the real verifier) or 'audit' (gate + extra stricter tests; used only to measure the gate, never to gate).
 * Returns { status: 'pass' | 'fail' | 'error', code, detail } - 'error' means the gate could not evaluate
 * (sandbox unavailable), which must never be read as either pass or fail of the agent's work.
 */
async function runHiddenGate({ task, workspace, suite = 'gate', run = runInSandbox, timeoutMs = 90_000 }) {
  if (suite !== 'gate' && suite !== 'audit') throw new TypeError('suite must be gate or audit');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-gate-'));
  try {
    const missing = assembleGateDir(task, workspace, dest, suite);
    if (missing.length) return { status: 'fail', code: 'MISSING_OUTPUT', detail: missing.join(',') };
    const r = await run({ workspace: dest, argv: suite === 'audit' ? task.meta.audit_test_argv : task.meta.gate_test_argv, timeoutMs });
    if (r.spawnError) return { status: 'error', code: 'SANDBOX_UNAVAILABLE', detail: String(r.spawnError) };
    if (r.timedOut) return { status: 'fail', code: 'TIMEOUT', detail: 'hidden tests exceeded the time limit' };
    if (r.truncated) return { status: 'fail', code: 'OUTPUT_LIMIT', detail: 'hidden test output exceeded the size limit' };
    if (r.exitCode === 125 || r.exitCode === 126 || r.exitCode === 127) return { status: 'error', code: 'SANDBOX_ERROR', detail: `docker exit ${r.exitCode}: ${r.stderr.slice(0, 200)}` };
    const tap = parseTap(r.stdout);
    if (r.exitCode === 0 && tap.tests > 0 && tap.fail === 0 && tap.pass === tap.tests) return { status: 'pass', code: suite === 'audit' ? 'AUDIT_PASS' : 'HIDDEN_TESTS_PASS', detail: `${tap.pass}/${tap.tests}` };
    return { status: 'fail', code: suite === 'audit' ? 'AUDIT_FAIL' : 'HIDDEN_TESTS_FAIL', detail: `exit ${r.exitCode}, ${tap.pass}/${tap.tests} passed` };
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({ assembleGateDir, loadTask, parseTap, runHiddenGate });
