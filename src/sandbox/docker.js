'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { runProcess } = require('../util/proc');
const { bundleFromDir, encodeBundle } = require('./bundle');
const { SlotPool } = require('./slots');

// Runs a command inside a throwaway, locked-down Docker container. Used for the agent's run_tests tool and for the
// hidden-test gate, so model-written code never runs directly on the host.
//
// Fixed flags (see docs/AGENT_BENCHMARK.md):
//   --rm --init --network none --memory 256m --memory-swap 256m --cpus 1 --pids-limit 128 --user node --read-only
//   --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp --ulimit fsize=16MiB --ulimit nofile=512
//   --label warrant=1 (so stale containers can be found and removed)
//
// Two ways to give the command its files:
//   copy  (mode: 'copy'; used for everything the benchmark runs): the files are streamed into a size- and inode-limited tmpfs at /work
//         through stdin; no host directory is mounted, so nothing the code writes can reach the host disk and the container
//         can not see any host path (not even in /proc/self/mountinfo).
//   bind  (mode: 'bind', kept for tests that need to read what the container wrote): the workspace is the only writable bind mount.
const DEFAULT_IMAGE = 'node:22-alpine';
const DEFAULTS = Object.freeze({
  memory: '256m', cpus: '1', pidsLimit: 128, user: 'node', tmpfsSize: '64m', workSize: '64m', workInodes: 4096, fileSizeLimit: 16 * 1024 * 1024,
  openFiles: 512, timeoutMs: 60_000, maxOutputBytes: 256 * 1024, maxStderrBytes: 1024 * 1024, maxBundleBytes: 64 * 1024 * 1024, concurrency: 2,
});
const LABEL = 'warrant=1';
const BOOT_MARK = '@@warrant-boot\n';
const BOOT_SOURCE = fs.readFileSync(path.join(__dirname, 'boot.js'), 'utf8');

// The image can be pinned (e.g. node:22-alpine@sha256:...) without touching code.
function resolveImage(image) {
  return image || process.env.WARRANT_SANDBOX_IMAGE || DEFAULT_IMAGE;
}

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

function buildDockerArgs({
  name, workspace, argv, image, memory = DEFAULTS.memory, cpus = DEFAULTS.cpus, pidsLimit = DEFAULTS.pidsLimit, tmpfsSize = DEFAULTS.tmpfsSize, env = {},
  mode = 'bind', interactive = false, workSize = DEFAULTS.workSize, bootOptions = null, network = 'none',
}) {
  if (!/^(?:none|container:[A-Za-z0-9][A-Za-z0-9_.-]*)$/.test(network)) throw new TypeError('network must be none or container:<name>');
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string' && !a.includes('\0'))) throw new TypeError('argv must be a non-empty array of strings');
  if (mode !== 'bind' && mode !== 'copy') throw new TypeError('mode must be bind or copy');
  const args = [
    'run', '--rm', '--init', '--name', name, '--label', LABEL,
    ...(interactive || mode === 'copy' ? ['-i'] : []),
    '--network', network,
    '--memory', memory, '--memory-swap', memory,
    '--cpus', String(cpus), '--pids-limit', String(pidsLimit),
    '--ulimit', `fsize=${DEFAULTS.fileSizeLimit}:${DEFAULTS.fileSizeLimit}`, '--ulimit', `nofile=${DEFAULTS.openFiles}:${DEFAULTS.openFiles}`,
    '--user', DEFAULTS.user, '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', `/tmp:rw,nosuid,size=${tmpfsSize}`,
  ];
  if (mode === 'bind') args.push('--mount', `type=bind,source=${mountSource(workspace)},target=/work`);
  else args.push('--tmpfs', `/work:rw,nosuid,size=${workSize},nr_inodes=${DEFAULTS.workInodes},mode=0755,uid=1000,gid=1000`);
  args.push('-w', '/work', '-e', 'HOME=/tmp', '-e', 'CI=1');
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new TypeError(`bad environment variable name ${k}`);
    args.push('-e', `${k}=${v}`);
  }
  const img = resolveImage(image);
  if (mode === 'bind') args.push(img, ...argv);
  else args.push(img, 'node', '-e', BOOT_SOURCE, JSON.stringify({ ...bootOptions, argv }));
  return args;
}

function sync(argv, timeoutMs = 20_000) {
  return spawnSync('docker', argv, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: dockerEnv() });
}

// { available, reason } - never throws. A test or script uses this to decide to skip with a visible reason.
function dockerStatus(image) {
  const img0 = resolveImage(image);
  const info = sync(['version', '--format', '{{.Server.Version}}']);
  if (info.error) return { available: false, reason: `docker CLI not runnable: ${info.error.code || info.error.message}` };
  if (info.status !== 0) return { available: false, reason: 'docker daemon is not reachable (is Docker Desktop running?)' };
  const img = sync(['image', 'inspect', img0, '--format', '{{.Id}}']);
  if (img.status !== 0) return { available: false, reason: `image ${img0} is not present (run: docker pull ${img0})` };
  return { available: true, reason: `docker ${info.stdout.trim()} with ${img0}` };
}

// What actually ran: the image reference and its content digest, for the run metadata. { image, id, digest } (null fields when unknown).
function imageInfo(image) {
  const ref = resolveImage(image);
  const r = sync(['image', 'inspect', ref, '--format', '{{.Id}}|{{range .RepoDigests}}{{.}} {{end}}']);
  if (r.status !== 0) return { image: ref, id: null, digest: null };
  const [id, digests] = r.stdout.trim().split('|');
  return { image: ref, id: id || null, digest: (digests || '').trim().split(' ')[0] || null };
}

// Pulls the image when it is missing; explicit, never called from tests.
function ensureImage(image) {
  const ref = resolveImage(image);
  if (sync(['image', 'inspect', ref, '--format', '{{.Id}}']).status === 0) return true;
  return sync(['pull', ref], 600_000).status === 0;
}

function killContainer(name) {
  return runProcess({ argv: ['docker', 'rm', '-f', name], cwd: process.cwd(), timeoutMs: 20_000, env: dockerEnv(), maxOutputBytes: 64 * 1024 });
}

// Removes warrant containers older than `olderThanMs` (a previous run was killed hard and left some behind).
// Every container also carries its own in-container deadline, so this is a safety net.
function sweepStale({ olderThanMs = 15 * 60_000, now = Date.now(), namePrefix = 'warrant-' } = {}) {
  const list = sync(['ps', '-a', '--filter', `label=${LABEL}`, '--filter', `name=${namePrefix}`, '--format', '{{.ID}}']);
  if (list.status !== 0) return { removed: [], error: 'docker not reachable' };
  const removed = [];
  for (const id of list.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const created = sync(['inspect', '-f', '{{.Created}}', id]);
    const t = created.status === 0 ? Date.parse(created.stdout.trim()) : NaN;
    if (Number.isFinite(t) && now - t >= olderThanMs && sync(['rm', '-f', id]).status === 0) removed.push(id);
  }
  return { removed };
}

// ---------------------------------------------------------------- concurrency: the docker CLI fails under memory pressure

// 2 containers at once machine-wide (the docker CLI fails under memory pressure); the test runner starts test files in parallel and is given 4.
const pool = new SlotPool({ limit: Number(process.env.WARRANT_SANDBOX_CONCURRENCY) || (process.env.NODE_TEST_CONTEXT ? 4 : DEFAULTS.concurrency) });

/** Waits for `n` container slots at once, across every process on this machine (a gate pair takes both). Returns release(). */
function acquireSlots(n = 1) {
  return pool.acquire(n);
}

// ---------------------------------------------------------------- copy mode

/**
 * Starts a container whose /work is a tmpfs filled from `files` ([{p, data}]) and runs argv there, with a deadline of its own.
 * Resolves `result` (never rejects) like runInSandbox. With `proto`, descriptors 3 and 4 of the command are connected to the
 * container's stdin and stdout (the protocol channel the gate used first), `onStdout` receives that stream, and the command's own
 * stdout and stderr end up in the result's stderr (capped). With `link` ({ role: 'listen' | 'connect', port }) the descriptors are instead
 * connected over TCP on the container's loopback; `network: 'container:<name>'` makes this container share the network namespace (loopback
 * only, no outside network) of a running one, which is how the gate's two containers talk without the host in between.
 * The returned `booted` promise resolves true once the supervisor inside the container has started, false if the container ended first.
 */
function spawnSandbox({ argv, files, proto = false, timeoutMs = DEFAULTS.timeoutMs, maxOutputBytes = DEFAULTS.maxOutputBytes, maxStderrBytes = DEFAULTS.maxStderrBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, workSize, env, onStdout, name = containerName(), link = null, network = 'none' }) {
  const bootOptions = { proto, link, deadlineMs: timeoutMs + 10_000, maxBundle: DEFAULTS.maxBundleBytes, maxStderr: maxStderrBytes };
  const args = buildDockerArgs({ name, argv, image, memory, cpus, pidsLimit, tmpfsSize, workSize, env, mode: 'copy', interactive: true, bootOptions, network });
  let resolveBooted;
  const booted = new Promise((resolve) => { resolveBooted = resolve; });
  let timedOut = false;
  let aborted = false;
  let truncated = false;
  let killed = null;
  const kill = () => { if (!killed) killed = killContainer(name); return killed; };
  const out = { stdout: [], stderr: [] };
  let bytes = 0;
  let spawnErr = null;
  let child;
  let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  try {
    child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], env: dockerEnv(), windowsHide: true });
  } catch (error) {
    finish({ exitCode: null, spawnError: error.code || 'SPAWN_FAILED', stdout: '', stderr: '', timedOut: false, aborted: false, truncated: false, container: name });
    resolveBooted(false);
    return { name, write: () => false, end: () => {}, kill: () => {}, result, booted };
  }
  child.stdin.on('error', () => {});
  let bundle;
  try { bundle = encodeBundle(files || []); } catch (error) { spawnErr = `BUNDLE_ERROR: ${error.message}`; }
  if (bundle) child.stdin.write(bundle); else kill();
  if ((!proto || link) && bundle) child.stdin.end();
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const backstop = setTimeout(() => { try { child.kill(); } catch (_error) { /* gone */ } }, timeoutMs + 20_000);
  const onAbort = () => { aborted = true; kill(); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let up = false; // the supervisor inside the container has started: from now on stderr text is the code's, not the docker CLI's
  const capture = (name2) => (chunk) => {
    if (name2 === 'stderr' && !up) {
      const text = chunk.toString('latin1');
      const at = text.indexOf(BOOT_MARK);
      if (at !== -1) { up = true; resolveBooted(true); chunk = Buffer.concat([chunk.subarray(0, at), chunk.subarray(at + BOOT_MARK.length)]); if (chunk.length === 0) return; }
    }
    bytes += chunk.length;
    if (bytes > maxOutputBytes + (proto ? maxStderrBytes : 0) && !truncated) { truncated = true; kill(); return; }
    if (!truncated) out[name2].push(chunk);
  };
  child.stdout.on('data', onStdout ? (chunk) => onStdout(chunk) : capture('stdout'));
  child.stderr.on('data', capture('stderr'));
  child.on('error', (error) => { spawnErr = error.code || 'SPAWN_FAILED'; });
  child.on('close', (exitCode) => {
    clearTimeout(timer);
    clearTimeout(backstop);
    if (signal) signal.removeEventListener('abort', onAbort);
    const done = () => {
      const stderr = Buffer.concat(out.stderr).toString('utf8');
      const r = { exitCode, stdout: Buffer.concat(out.stdout).toString('utf8'), stderr, spawnError: spawnErr, timedOut, aborted, truncated, container: name };
      // A docker failure text counts as infrastructure only before the container's own supervisor spoke: after that, anything on stderr is the
      // code under test, which must not be able to pass for a daemon error (it would get its run excluded instead of judged).
      resolveBooted(false);
      r.spawnError = r.spawnError || (up ? (typeof exitCode === 'number' && exitCode >= 0xC0000000 ? infraFailure({ exitCode, stderr: '' }) : null) : infraFailure(r));
      finish(r);
    };
    if (truncated || timedOut || aborted || spawnErr) Promise.resolve(kill()).then(done, done); else done();
  });
  return {
    name,
    write: (text) => { try { return child.stdin.write(text); } catch (_error) { return false; } },
    end: () => { try { child.stdin.end(); } catch (_error) { /* closed */ } },
    kill: () => { aborted = true; return kill(); },
    result,
    booted,
  };
}

/**
 * Run argv inside a sandbox container. Resolves (never rejects) with
 * { exitCode, stdout, stderr, timedOut, aborted, truncated, spawnError, container }.
 * Give it `workspace` (a host directory) or `files` ([{p, data}]). mode 'bind' (the default, kept for compatibility) mounts the
 * workspace read-write; mode 'copy' copies it into a tmpfs and is what the agent worker and the gate use.
 * Timeout, abort and output-cap overflow all remove the container by name (the docker CLI process being killed is
 * not enough: the container would live on), and the container is always removed on a non-clean end.
 */
async function runInSandbox({ argv, workspace, files, mode = 'bind', timeoutMs = DEFAULTS.timeoutMs, maxOutputBytes = DEFAULTS.maxOutputBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, workSize, env }) {
  const release = await acquireSlots(1);
  try {
    // The wait for a slot can outlast an abort: do not start a container nobody wants.
    if (signal && signal.aborted) return { exitCode: null, stdout: '', stderr: '', spawnError: null, timedOut: false, aborted: true, truncated: false, container: null };
    if (mode !== 'copy') return await runBound({ argv, workspace, timeoutMs, maxOutputBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, env });
    let copied = files;
    if (!copied) {
      try { copied = bundleFromDir(workspace); } catch (error) { return { exitCode: null, stdout: '', stderr: '', spawnError: `BUNDLE_ERROR: ${error.message}`, timedOut: false, aborted: false, truncated: false, container: null }; }
    }
    const handle = spawnSandbox({ argv, files: copied, timeoutMs, maxOutputBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, workSize, env });
    return await handle.result;
  } finally {
    release();
  }
}

async function runBound({ argv, workspace, timeoutMs, maxOutputBytes, signal, image, memory, cpus, pidsLimit, tmpfsSize, env }) {
  const name = containerName();
  const args = buildDockerArgs({ name, workspace, argv, image, memory, cpus, pidsLimit, tmpfsSize, env, mode: 'bind' });
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
    exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, spawnError: result.spawnError || infraFailure(result),
    timedOut: timedOut || result.timedOut, aborted, truncated: result.truncated, container: name,
  };
}

// The docker CLI itself (not the code under test) failed: Go runtime crashes under host memory pressure, daemon
// errors, a Windows process crash. Such a run says nothing about the code, so it is reported as a spawnError and a
// caller must retry or exclude it rather than count it as a test failure.
const INFRA_STDERR = /^fatal error: |^panic: |runtime stack:|goroutine \d+ \[|^docker: (?:error|Error response from daemon)|Cannot connect to the Docker daemon|error during connect/m;
function infraFailure(result) {
  if (typeof result.exitCode === 'number' && result.exitCode >= 0xC0000000) return `docker CLI crashed (exit code ${result.exitCode})`;
  const m = INFRA_STDERR.exec(result.stderr || '');
  return m ? `docker infrastructure failure: ${(result.stderr || '').split('\n')[0].slice(0, 120)}` : null;
}

function containerExists(name) {
  const r = sync(['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}']);
  return r.status === 0 && r.stdout.trim() === name;
}

module.exports = Object.freeze({
  DEFAULTS, DEFAULT_IMAGE, LABEL, acquireSlots, buildDockerArgs, containerExists, dockerEnv, dockerStatus, ensureImage, imageInfo, infraFailure,
  killContainer, mountSource, resolveImage, runInSandbox, spawnSandbox, sweepStale,
});
