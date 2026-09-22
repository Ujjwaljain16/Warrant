'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runPair } = require('../gate/relay');
const { bundleFromDir } = require('../sandbox/bundle');
const { BENCH_ROOT, MAX_FILE_BYTES, loadTask, testFiles } = require('./task');

// The hidden-test gate.
//
// What is judged: the declared output files of the agent's workspace, nothing else. The gate never runs them in the same
// process as the tests: it starts two containers (see src/gate/relay.js).
//   solution container  the pristine starting repo with the declared outputs replaced by the agent's files. No hidden test,
//                       no expected value, no verdict channel.
//   verdict container   the hidden tests, node:test and assert, run unmodified. `require('./solution')` inside a test returns
//                       a proxy: every call on it travels to the solution container and back, and the values that come back
//                       are ordinary data to the assertions.
// So the solution can not exit the test process, patch assert or node:test, read the hidden tests or the expected values,
// write the verdict stream, or change the result of an assertion. What it can still do is answer correctly only
// for inputs it recognises (see THREAT_MODEL.md, T18), burn its time limit, or crash: all of which end as a fail.
const GATE_VERSION = 'split-1';
// bench/agent-claims/gate-manifest.json pins, per task and test file, exactly which tests the reference solution runs (written by
// scripts/agent-task-check.js --write-manifest). A gate run whose verdict lists other tests (or a different number) is a failure.
const GATE_MANIFEST = path.join(BENCH_ROOT, 'gate-manifest.json');
const SUITE_CODES = Object.freeze({ gate: { pass: 'HIDDEN_TESTS_PASS', fail: 'HIDDEN_TESTS_FAIL' }, audit: { pass: 'AUDIT_PASS', fail: 'AUDIT_FAIL' } });

function loadManifest(file = GATE_MANIFEST) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; }
}

const manifestKey = (task) => `${task.split}/${task.id}`;

// The pins of one task, or null when the manifest does not cover it.
function expectedFor(manifest, task) {
  const entry = manifest && manifest.tasks && manifest.tasks[manifestKey(task)];
  return entry || null;
}

// A regular file of an acceptable size; links and special files are never taken from the agent's workspace.
function readOutput(workspace, name) {
  const src = path.join(workspace, name);
  let stat = null;
  try { stat = fs.lstatSync(src); } catch (_error) { /* missing */ }
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;
  return fs.readFileSync(src);
}

/** The two file sets of a gate run, or { missing } when the agent did not produce every declared output. */
function assembleGateFiles(task, workspace, suite = 'gate') {
  const outputs = task.meta.outputs;
  const solution = new Map();
  const missing = [];
  for (const name of outputs) {
    const data = readOutput(workspace, name);
    if (data === null) missing.push(name); else solution.set(name, data);
  }
  if (missing.length) return { missing };
  const repo = bundleFromDir(task.repoDir);
  const solutionFiles = [...repo.filter((f) => !solution.has(f.p)), ...[...solution].map(([p, data]) => ({ p, data }))];
  // The verdict side gets the pristine repo files that are not outputs (a test may import a helper) and the hidden tests; never the agent's files.
  const hidden = [...bundleFromDir(task.gateDir), ...(suite === 'audit' ? bundleFromDir(task.auditDir) : [])];
  const verdictFiles = [...repo.filter((f) => !outputs.includes(f.p)), ...hidden];
  return { solutionFiles, verdictFiles, outputs };
}

// Names of the failing top-level tests in node's TAP output ("not ok 3 - name"), capped; for reports, never for decisions.
function failedTestNames(stdout, limit = 20) {
  const names = [];
  const re = /^not ok \d+ - (.*)$/gm;
  let m;
  while ((m = re.exec(stdout)) && names.length < limit) names.push(m[1].slice(0, 120));
  return names;
}

// node --test with the TAP reporter ends with "# tests N / # pass N / # fail N". Kept for tooling that reads TAP text; the gate itself
// does not decide from output text any more.
function parseTap(stdout) {
  const num = (name) => {
    const m = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(stdout);
    return m ? Number(m[1]) : null;
  };
  return { tests: num('tests'), pass: num('pass'), fail: num('fail') };
}

// The strict reading of one verdict: every test passed, none was skipped, cancelled or left pending, and (when the caller knows
// what the suite contains) exactly the expected tests ran, in order.
function readVerdict(verdict, expected) {
  if (!verdict || verdict.version !== 1 || !verdict.counts || !Array.isArray(verdict.top)) return { ok: false, reason: 'malformed verdict' };
  const c = verdict.counts;
  if (!['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].every((k) => Number.isSafeInteger(c[k]) && c[k] >= 0)) return { ok: false, reason: 'malformed counts' };
  const failed = verdict.top.filter((t) => t.ok !== true).map((t) => t.n);
  const pass = c.tests > 0 && c.pass === c.tests && c.fail === 0 && c.cancelled === 0 && c.skipped === 0 && c.todo === 0 && failed.length === 0 && verdict.top.length > 0;
  if (pass && expected) {
    const names = verdict.top.map((t) => t.n);
    if (c.tests !== expected.tests || names.length !== expected.names.length || names.some((n, i) => n !== expected.names[i])) {
      return { ok: false, reason: `the suite ran ${c.tests} test(s) [${names.join(' | ').slice(0, 200)}], expected ${expected.tests}`, mismatch: true, counts: c, failed };
    }
  }
  return { ok: pass, counts: c, failed, reason: pass ? null : 'tests failed' };
}

async function runOne({ pairFiles, testFile, outputs, timeoutMs, expected, runner, image, signal }) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await runner({ ...pairFiles, testFile, outputs, timeoutMs, image, signal });
    if (!last.spawnError) break;
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return { r: last, read: last.verdict ? readVerdict(last.verdict, expected) : null };
}

/**
 * `suite` is 'gate' (the real verifier) or 'audit' (gate + extra stricter tests; used only to measure the gate, never to gate).
 * Returns { status: 'pass' | 'fail' | 'error', code, detail } - 'error' means the gate could not evaluate
 * (sandbox unavailable), which must never be read as either pass or fail of the agent's work.
 * `expected` ({ '<test file>': { tests, names } }) pins exactly which tests must run; `runner` replaces the container pair (tests only).
 */
async function runHiddenGate({ task, workspace, suite = 'gate', timeoutMs, expected, runner = runPair, image, signal }) {
  if (suite !== 'gate' && suite !== 'audit') throw new TypeError('suite must be gate or audit');
  // Per test file. The audit has more files and calls (the slowest suite makes ~15 000 proxied calls); it only measures, so it gets more room (the slowest takes about 10 s).
  const limitMs = timeoutMs === undefined ? (suite === 'audit' ? 120_000 : 90_000) : timeoutMs;
  const codes = SUITE_CODES[suite];
  const pins = expected === undefined ? expectedFor(loadManifest(), task) : expected;
  const started = Date.now();
  const files = assembleGateFiles(task, workspace, suite);
  if (files.missing) return { status: 'fail', code: 'MISSING_OUTPUT', detail: files.missing.join(',') };
  const argv = suite === 'audit' ? task.meta.audit_test_argv : task.meta.gate_test_argv;
  const total = { tests: 0, pass: 0 };
  const perFile = [];
  for (const testFile of testFiles(argv)) {
    const { r, read } = await runOne({
      pairFiles: { solutionFiles: files.solutionFiles, verdictFiles: files.verdictFiles }, testFile, outputs: files.outputs, timeoutMs: limitMs, expected: pins && pins[testFile], runner, image, signal,
    });
    perFile.push({ testFile, solutionExit: r.solutionExit, verdictExit: r.verdictExit, rpc: r.verdict && r.verdict.rpc, relayed: r.relayed, tests: read && read.counts ? read.counts.tests : null, names: r.verdict && Array.isArray(r.verdict.top) ? r.verdict.top.map((t) => t.n) : null });
    const meta = { gate: GATE_VERSION, ms: Date.now() - started, files: perFile };
    if (r.spawnError) return { status: 'error', code: 'SANDBOX_UNAVAILABLE', detail: String(r.spawnError), ...meta };
    if (r.timedOut) return { status: 'fail', code: 'TIMEOUT', detail: 'hidden tests exceeded the time limit', ...meta };
    if (r.truncated) return { status: 'fail', code: 'OUTPUT_LIMIT', detail: 'the solution or the test traffic exceeded the size limit', ...meta };
    if (r.solutionExited) return { status: 'fail', code: 'SOLUTION_EXITED', detail: `the solution process ended before the tests finished (exit ${r.solutionExit})`, ...meta };
    if (!r.verdict) return { status: 'fail', code: 'GATE_NO_VERDICT', detail: `${r.problem || 'no verdict'}; verdict process exit ${r.verdictExit}`, ...meta };
    if (r.verdict.aborted === 'SOLUTION_EXITED') return { status: 'fail', code: 'SOLUTION_EXITED', detail: `the solution process ended before the tests finished (exit ${r.solutionExit})`, ...meta };
    if (r.verdict.aborted) return { status: 'fail', code: 'GATE_ABORTED', detail: `${r.verdict.aborted}: ${r.verdict.detail || ''}`.slice(0, 300), ...meta };
    if (r.verdictExit !== 0) return { status: 'fail', code: codes.fail, detail: `verdict process exit ${r.verdictExit}`, ...meta };
    if (!read.ok) {
      const c = read.counts || { pass: 0, tests: 0 };
      return {
        status: 'fail', code: read.mismatch ? 'GATE_SUITE_MISMATCH' : codes.fail, detail: read.mismatch ? read.reason : `exit 1, ${c.pass + total.pass}/${c.tests + total.tests} passed`, // "exit 1": what a test runner reports for failed tests (reports and samples keep this wording)
        failed_tests: (read.failed || []).slice(0, 20).map((n) => n.slice(0, 120)), ...meta,
      };
    }
    total.tests += read.counts.tests;
    total.pass += read.counts.pass;
  }
  return { status: 'pass', code: codes.pass, detail: `${total.pass}/${total.tests}`, gate: GATE_VERSION, ms: Date.now() - started, files: perFile };
}

module.exports = Object.freeze({ GATE_MANIFEST, GATE_VERSION, assembleGateFiles, expectedFor, failedTestNames, loadManifest, loadTask, manifestKey, parseTap, readVerdict, runHiddenGate });
