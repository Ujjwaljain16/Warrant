'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runProcess } = require('../util/proc');

// Runs a command inside a throwaway, locked-down Docker container. Used for both the agent's run_tests tool and
// the hidden-test gate, so the model-written code never runs directly on the host.
//
// Fixed flags (see docs/AGENT_BENCHMARK.md):
//   --rm --network none --memory 256m --memory-swap 256m --cpus 1 --pids-limit 128 --user node --read-only
//   --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp
//   the workspace is the only writable bind mount, at /work
const DEFAULT_IMAGE = 'node:22-alpine';
const DEFAULTS = Object.freeze({ memory: '256m', cpus: '1', pidsLimit: 128, user: 'node', tmpfsSize: '64m', timeoutMs: 60_000, maxOutputBytes: 256 * 1024 });

// Docker CLI needs a few profile variables to find its config and engine; nothing else (and no API keys) is passed.
const DOCKER_ENV_KEYS = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'ProgramData', 'ProgramFiles', 'ALLUSERSPROFILE', 'TEMP', 'TMP', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'];

function dockerEnv(source = process.env) {
  const env = {};
  for (const key of DOCKER_ENV_KEYS) if (source[key] !== undefined) env[key] = source[key];
  return env;
}

// --mount (not -v) so a Windows drive-letter colon is never ambiguous; commas and quotes would break its key=value syntax.
function mountSource(dir) {
  const resolved = path.resolve(dir);
  if (/[,"\n\r\0]/.test(resolved)) throw new Error(`workspace path contains characters that cannot be bind-mounted: ${resolved}`);
  return resolved;
}

function containerName() {
  return `warrant-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
}

function buildDockerArgs({ name, workspace, argv, image = DEFAULT_IMAGE, memory = DEFAULTS.memory, cpus = DEFAULTS.cpus, pidsLimit = DEFAULTS.pidsLimit, tmpfsSize = DEFAULTS.tmpfsSize, env = {} }) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string' && !a.includes('\0'))) throw new TypeError('argv must be a non-empty array of strings');
  const args = [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--memory', memory, '--memory-swap', memory,
    '--cpus', String(cpus), '--pids-limit', String(pidsLimit),
    '--user', DEFAULTS.user, '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', `/tmp:rw,nosuid,size=${tmpfsSize}`,
    '--mount', `type=bind,source=${mountSource(workspace)},target=/work`,
    '-w', '/work',
    '-e', 'HOME=/tmp', '-e', 'CI=1',
  ];
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new TypeError(`bad environment variable name ${k}`);
    args.push('-e', `${k}=${v}`);
  }
  args.push(image, ...argv);
  return args;
}

function sync(argv, timeoutMs = 20_000) {
  return spawnSync('docker', argv, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: dockerEnv() });
}

// { available, reason } - never throws. A test or script uses this to decide to skip with a visible reason.
function dockerStatus(image = DEFAULT_IMAGE) {
  const info = sync(['version', '--format', '{{.Server.Version}}']);
  if (info.error) return { available: false, reason: `docker CLI not runnable: ${info.error.code || info.error.message}` };
  if (info.status !== 0) return { available: false, reason: 'docker daemon is not reachable (is Docker Desktop running?)' };
  const img = sync(['image', 'inspect', image, '--format', '{{.Id}}']);
  if (img.status !== 0) return { available: false, reason: `image ${image} is not present (run: docker pull ${image})` };
  return { available: true, reason: `docker ${info.stdout.trim()} with ${image}` };
}

// Pulls the image when it is missing; explicit, never called from tests.
function ensureImage(image = DEFAULT_IMAGE) {
  if (sync(['image', 'inspect', image, '--format', '{{.Id}}']).status === 0) return true;
  return sync(['pull', image], 600_000).status === 0;
}

function killContainer(name) {
  return runProcess({ argv: ['docker', 'rm', '-f', name], cwd: process.cwd(), timeoutMs: 20_000, env: dockerEnv(), maxOutputBytes: 64 * 1024 });
}

/**
 * Run argv inside a sandbox container with `workspace` mounted at /work. Resolves (never rejects) with
 * { exitCode, stdout, stderr, timedOut, aborted, truncated, spawnError, container }.
 * Timeout, abort and output-cap overflow all remove the container by name (the docker CLI process being killed is
 * not enough: the container would live on), and the container is always removed on a non-clean end.
 */
async function runInSandbox({ argv, workspace, timeoutMs = DEFAULTS.timeoutMs, maxOutputBytes = DEFAULTS.maxOutputBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, env }) {
  const name = containerName();
  const args = buildDockerArgs({ name, workspace, argv, image, memory, cpus, pidsLimit, tmpfsSize, env });
  let timedOut = false;
  let aborted = false;
  let killed = null;
  const kill = () => { if (!killed) killed = killContainer(name); return killed; };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const onAbort = () => { aborted = true; kill(); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let result;
  try {
    // The CLI backstop fires only if the container kill above somehow did not end the run.
    result = await runProcess({ argv: ['docker', ...args], cwd: process.cwd(), timeoutMs: timeoutMs + 15_000, maxOutputBytes, env: dockerEnv() });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (result.truncated || result.timedOut || result.spawnError || timedOut || aborted) await kill();
  return {
    exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, spawnError: result.spawnError,
    timedOut: timedOut || result.timedOut, aborted, truncated: result.truncated, container: name,
  };
}

function containerExists(name) {
  const r = sync(['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}']);
  return r.status === 0 && r.stdout.trim() === name;
}

module.exports = Object.freeze({ DEFAULTS, DEFAULT_IMAGE, buildDockerArgs, containerExists, dockerEnv, dockerStatus, ensureImage, mountSource, runInSandbox });
