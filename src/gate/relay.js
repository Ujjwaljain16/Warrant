'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { acquireSlots, spawnSandbox } = require('../sandbox/docker');

// The host side of the split gate. Two containers are started:
//   solution  holds the agent's code and nothing else (no network except its own loopback);
//   verdict   holds the hidden tests and the node:test runner, joins the solution container's network namespace (loopback only, so it
//             can reach the solution container and nothing outside), and prints the verdict (with a nonce).
// The two talk over one TCP connection on that loopback (see src/sandbox/boot.js): the host is not in the data path, which keeps a round trip
// near a third of a millisecond instead of several (a test that makes thousands of calls, or that depends on timing, needs that). The host starts
// them, enforces the time limit, watches for the solution container ending early, and reads the verdict from the verdict container's
// stderr. Nothing the solution container prints can reach the verdict channel: its stdout and stderr are kept for diagnostics only.
const HARNESS_DIR = path.join(__dirname, 'container');
const HARNESS_FILES = ['channel.js', 'io-reader.js', 'io-writer.js', 'membrane.js', 's-main.js', 'v-main.js'];
const PREFIX = '@@wrp ';
const LINK_PORT = 7421;

const harnessFiles = (cfg) => [
  ...HARNESS_FILES.map((f) => ({ p: `.warrant-gate/${f}`, data: fs.readFileSync(path.join(HARNESS_DIR, f)) })),
  { p: '.warrant-gate/config.json', data: Buffer.from(JSON.stringify(cfg)) },
];

function parseVerdict(stderr, nonce) {
  const marker = `@@verdict ${nonce} `;
  const found = [];
  for (const line of stderr.split('\n')) if (line.startsWith(marker)) found.push(line.slice(marker.length));
  if (found.length !== 1) return { verdict: null, problem: found.length === 0 ? 'no verdict line' : 'more than one verdict line' };
  try { return { verdict: JSON.parse(found[0]) }; } catch (_error) { return { verdict: null, problem: 'unreadable verdict line' }; }
}

/**
 * Runs one test file against one solution.
 *   verdictFiles / solutionFiles  [{p, data}] to copy into the two containers (the harness is added here)
 *   testFile      path of the hidden test inside the verdict container
 *   outputs       declared output files the test may require
 * Resolves with { verdict, problem, solutionExit, verdictExit, solutionExited, timedOut, truncated, spawnError, ... }.
 */
async function runPair({ verdictFiles, solutionFiles, testFile, outputs, timeoutMs = 90_000, image, signal }) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const base = { inFd: 3, outFd: 4 };
  const verdictCfg = { ...base, testFile, outputs, nonce };
  const solutionCfg = { ...base, outputs };
  const release = await acquireSlots(2);
  const state = { solutionExited: false, verdictDone: false };
  try {
    const solutionHandle = spawnSandbox({
      argv: ['node', '/work/.warrant-gate/s-main.js'], files: [...harnessFiles(solutionCfg), ...solutionFiles], proto: true, link: { role: 'listen', port: LINK_PORT },
      timeoutMs, image, signal,
    });
    // The verdict container shares the solution container's network namespace, so it can only start once that container is running.
    const up = await Promise.race([solutionHandle.booted, solutionHandle.result.then(() => false)]);
    if (!up) {
      const early = await solutionHandle.result;
      return {
        verdict: null, problem: 'the solution container did not start', verdictExit: null, solutionExit: early.exitCode, solutionExited: false, timedOut: early.timedOut,
        truncated: early.truncated, spawnError: early.spawnError || 'the solution container did not start', verdictStderr: '', solutionStderr: early.stderr.slice(0, 4000),
      };
    }
    const verdictHandle = spawnSandbox({
      argv: ['node', '/work/.warrant-gate/v-main.js'], files: [...harnessFiles(verdictCfg), ...verdictFiles], proto: true, link: { role: 'connect', port: LINK_PORT },
      network: `container:${solutionHandle.name}`, timeoutMs, image, signal,
    });
    // The solution ending before the verdict is in is a failure by itself: a test that expects "throws" must not be satisfied by a crash.
    // Closing the verdict side's input makes it report SOLUTION_EXITED itself (it also sees its connection close); if it does not do so
    // promptly it is killed.
    solutionHandle.result.then((r) => {
      if (state.verdictDone) return;
      state.solutionExited = true;
      state.solutionEarly = r;
      verdictHandle.end();
      setTimeout(() => { if (!state.verdictDone) verdictHandle.kill(); }, 4000).unref();
    });
    const verdictResult = await verdictHandle.result;
    state.verdictDone = true;
    solutionHandle.kill();
    const solutionResult = await solutionHandle.result;
    const { verdict, problem } = parseVerdict(verdictResult.stderr, nonce);
    return {
      verdict, problem, verdictExit: verdictResult.exitCode, solutionExit: solutionResult.exitCode, solutionExited: state.solutionExited,
      timedOut: verdictResult.timedOut || solutionResult.timedOut, truncated: verdictResult.truncated || solutionResult.truncated, aborted: verdictResult.aborted,
      spawnError: verdictResult.spawnError || solutionResult.spawnError || null,
      verdictStderr: verdictResult.stderr.slice(0, 4000), solutionStderr: solutionResult.stderr.slice(0, 200_000),
    };
  } finally {
    release();
  }
}

module.exports = Object.freeze({ HARNESS_FILES, LINK_PORT, PREFIX, parseVerdict, runPair });
