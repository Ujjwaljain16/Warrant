'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runInSandbox } = require('../sandbox/docker');
const { runHiddenGate } = require('./gate');
const { stableTestOutput } = require('./loop');
const { loadTask } = require('./task');

// A suite that does not finish in this time (a starting repo that loops forever, say) counts as a failure; the slowest legitimate suite takes ~10 s.
const SUITE_TIMEOUT_MS = 45_000;

// Executable checks that make the task suite trustworthy (run by `agent-task-check.js --run` and the test suite).

// A scratch workspace: the starting repo with a solution directory's files laid over it. Caller removes it.
function overlayWorkspace(task, solutionDir) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-overlay-'));
  fs.cpSync(task.repoDir, dest, { recursive: true });
  if (solutionDir) fs.cpSync(solutionDir, dest, { recursive: true });
  return dest;
}

async function visibleRun(task, workspace, run) {
  const r = await run({ workspace, argv: task.meta.visible_test_argv, timeoutMs: 60_000, mode: 'copy' });
  if (r.spawnError) return { status: 'error', detail: String(r.spawnError) };
  const pass = r.exitCode === 0 && !r.timedOut;
  return { status: pass ? 'pass' : 'fail', detail: `${r.exitCode}|${stableTestOutput(r.stdout)}` };
}

const digest = (r) => `${r.status} ${r.code || ''} ${r.detail}`;

/**
 * Returns a list of violated properties (empty = all hold). With `repeats` = 2 every suite is run twice and the two
 * results must be identical (a flaky or order-dependent suite would make the measurement meaningless).
 *   - the gate AND the audit suite fail on the starting repo (so "do nothing" is never a pass);
 *   - both pass on the reference solution (satisfiable), and so do the visible tests;
 *   - the visible tests on the starting repo are in the state meta.visible_on_start documents;
 *   - when the task has a naive solution: the visible tests pass on it but the gate fails (visible tests alone are
 *     not sufficient); the audit fails on it too (it is a superset of the gate).
 */
async function runTaskProperties(taskDir, { run = runInSandbox, repeats = 2, gate = runHiddenGate, expected, collect = null } = {}) {
  const task = loadTask(taskDir);
  const problems = [];
  const state = async (label, solutionDir) => {
    const ws = overlayWorkspace(task, solutionDir);
    try {
      const out = { label };
      for (const [name, probe] of [
        ['gate', () => gate({ task, workspace: ws, suite: 'gate', expected, timeoutMs: SUITE_TIMEOUT_MS })],
        ['audit', () => gate({ task, workspace: ws, suite: 'audit', expected, timeoutMs: SUITE_TIMEOUT_MS })],
        ['visible', () => visibleRun(task, ws, run)],
      ]) {
        const results = [];
        for (let i = 0; i < repeats; i++) {
          let r = await probe();
          for (let retry = 0; retry < 3 && r.status === 'error'; retry++) r = await probe(); // docker hiccups under load are not task defects
          results.push(r);
        }
        if (results.some((r) => r.status === 'error')) { out.error = `${name}: ${digest(results.find((r) => r.status === 'error'))}`; return out; }
        if (new Set(results.map(digest)).size !== 1) problems.push(`${name} suite is not deterministic on ${label}: ${results.map((r) => `[${digest(r).slice(0, 120)}]`).join(' vs ')}`);
        out[name] = results[0];
      }
      return out;
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  };

  const start = await state('the starting repo', null);
  if (start.error) return [`sandbox unavailable: ${start.error}`];
  if (start.gate.status !== 'fail') problems.push(`gate tests do not fail on the starting repo (${start.gate.status} ${start.gate.code})`);
  if (start.audit.status !== 'fail') problems.push(`audit tests do not fail on the starting repo (${start.audit.status} ${start.audit.code})`);
  if (start.visible.status !== task.meta.visible_on_start) problems.push(`visible tests on the starting repo are "${start.visible.status}", meta.visible_on_start says "${task.meta.visible_on_start}"`);

  const ref = await state('reference/', task.referenceDir);
  if (ref.error) return [...problems, `sandbox unavailable: ${ref.error}`];
  if (ref.gate.status !== 'pass') problems.push(`gate tests do not pass on reference/ (${ref.gate.status} ${ref.gate.code} ${ref.gate.detail})`);
  if (ref.audit.status !== 'pass') problems.push(`audit tests do not pass on reference/ (${ref.audit.status} ${ref.audit.code} ${ref.audit.detail})`);
  if (ref.visible.status !== 'pass') problems.push('visible tests do not pass on reference/');
  if (collect) { collect.gate = ref.gate; collect.audit = ref.audit; }

  if (task.naiveDir) {
    const naive = await state('naive/', task.naiveDir);
    if (naive.error) return [...problems, `sandbox unavailable: ${naive.error}`];
    if (naive.visible.status !== 'pass') problems.push('visible tests do not pass on naive/ (it must look correct to the visible tests)');
    if (naive.gate.status !== 'fail') problems.push(`gate tests do not fail on naive/ (${naive.gate.status} ${naive.gate.code}): visible tests would be sufficient`);
    if (naive.audit.status !== 'fail') problems.push(`audit tests do not fail on naive/ (${naive.audit.status} ${naive.audit.code})`);
  }
  return problems;
}

module.exports = Object.freeze({ overlayWorkspace, runTaskProperties });
