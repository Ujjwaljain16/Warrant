'use strict';

const { spawn } = require('node:child_process');

// Environment passed to child processes. Deliberately tiny: no inherited secrets.
const SAFE_ENV_KEYS = Object.freeze(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG']);

function scrubbedEnv(source = process.env) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) if (source[key] !== undefined) env[key] = source[key];
  return env;
}

function resolveCommand(argv) {
  // `node` means "the Node binary running this process", so specs are portable and PATH-independent.
  return argv[0] === 'node' ? process.execPath : argv[0];
}

function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (_error) {
    try { child.kill('SIGKILL'); } catch (_ignored) { /* already gone */ }
  }
}

// Runs argv without a shell. Resolves (never rejects) with a description of how the process ended.
function runProcess({ argv, cwd, timeoutMs = 10_000, maxOutputBytes = 1 << 20, signal, env = scrubbedEnv() }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(resolveCommand(argv), argv.slice(1), {
        cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolve({ exitCode: null, spawnError: error.code || 'SPAWN_FAILED', stdout: '', stderr: '', timedOut: false, aborted: false, truncated: false });
      return;
    }
    const out = { stdout: [], stderr: [] };
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let spawnError = null;
    let settled = false;

    const capture = (name) => (chunk) => {
      if (truncated) return;
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { truncated = true; killTree(child); return; }
      out[name].push(chunk);
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => { aborted = true; killTree(child); };
    if (signal) {
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    }
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode, spawnError, timedOut, aborted, truncated,
        stdout: Buffer.concat(out.stdout).toString('utf8'),
        stderr: Buffer.concat(out.stderr).toString('utf8'),
      });
    };
    child.on('error', (error) => { spawnError = error.code || 'SPAWN_FAILED'; finish(null); });
    child.on('close', (code) => finish(code));
  });
}

module.exports = Object.freeze({ SAFE_ENV_KEYS, killTree, resolveCommand, runProcess, scrubbedEnv });
