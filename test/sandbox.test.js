'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildDockerArgs, containerExists, dockerEnv, dockerStatus, mountSource, runInSandbox } = require('../src/sandbox/docker');

const status = dockerStatus();
// Tests that need Docker report why they are skipped instead of silently passing.
const dockerTest = (name, fn) => test(name, { skip: status.available ? false : `Docker unavailable: ${status.reason}`, timeout: 120_000 }, fn);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-sbx-${p}-`));
const node = (code) => ['node', '-e', code];

// ---- pure tests (run everywhere)

test('docker arguments carry every isolation flag and mount only the workspace', () => {
  const ws = tmp('args');
  const args = buildDockerArgs({ name: 'warrant-x', workspace: ws, argv: ['node', '--test'] });
  const flat = args.join(' ');
  for (const needle of ['--rm', '--network none', '--memory 256m', '--memory-swap 256m', '--cpus 1', '--pids-limit 128', '--user node', '--read-only', '--cap-drop ALL', 'no-new-privileges', '--tmpfs /tmp:']) {
    assert.ok(flat.includes(needle), `missing ${needle}`);
  }
  assert.equal(args.filter((a) => a === '--mount').length, 1, 'exactly one bind mount');
  assert.ok(args.includes(`type=bind,source=${path.resolve(ws)},target=/work`));
  assert.deepEqual(args.slice(-3), ['node:22-alpine', 'node', '--test']);
  assert.ok(!args.includes('--privileged') && !args.includes('--network=host'));
});

test('mount sources that could break the --mount syntax are refused; env names are validated', () => {
  assert.throws(() => mountSource('C:\\a,b'), /cannot be bind-mounted/);
  assert.throws(() => mountSource('C:\\a"b'), /cannot be bind-mounted/);
  assert.throws(() => buildDockerArgs({ name: 'n', workspace: tmp('env'), argv: ['x'], env: { 'bad name': '1' } }), TypeError);
  assert.throws(() => buildDockerArgs({ name: 'n', workspace: tmp('env'), argv: [] }), TypeError);
});

test('the docker CLI environment never includes API keys', () => {
  const env = dockerEnv({ PATH: '/bin', USERPROFILE: 'C:\\u', GEMINI_API_KEY: 'x'.repeat(30), WARRANT_LIVE: '1' });
  assert.deepEqual(Object.keys(env).sort(), ['PATH', 'USERPROFILE']);
});

// ---- container tests

dockerTest('runs a command and returns its output and exit code; workspace is mounted read-write at /work', async () => {
  const ws = tmp('ok');
  fs.writeFileSync(path.join(ws, 'in.txt'), 'hello from host');
  const r = await runInSandbox({ workspace: ws, argv: node("const fs=require('fs');console.log(fs.readFileSync('in.txt','utf8'));fs.writeFileSync('out.txt','from container');process.exit(3)") });
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout.trim(), 'hello from host');
  assert.equal(fs.readFileSync(path.join(ws, 'out.txt'), 'utf8'), 'from container');
  assert.equal(containerExists(r.container), false, '--rm removed the container');
});

dockerTest('no network: outbound connections and DNS fail', async () => {
  const ws = tmp('net');
  const code = `
    const net = require('net'); const dns = require('dns');
    const out = {};
    dns.lookup('example.com', (e) => {
      out.dns = e ? e.code : 'RESOLVED';
      const s = net.connect({ host: '1.1.1.1', port: 80, timeout: 3000 });
      s.on('connect', () => { out.tcp = 'CONNECTED'; console.log(JSON.stringify(out)); process.exit(0); });
      s.on('error', (err) => { out.tcp = err.code; console.log(JSON.stringify(out)); process.exit(0); });
      s.on('timeout', () => { out.tcp = 'TIMEOUT'; console.log(JSON.stringify(out)); process.exit(0); });
    });`;
  const r = await runInSandbox({ workspace: ws, argv: node(code), timeoutMs: 30_000 });
  const out = JSON.parse(r.stdout);
  assert.notEqual(out.dns, 'RESOLVED');
  assert.ok(['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'EAI_AGAIN', 'TIMEOUT'].includes(out.tcp), `tcp result ${out.tcp}`);
  assert.notEqual(out.tcp, 'CONNECTED');
});

dockerTest('read-only root and nothing writable outside the workspace and /tmp', async () => {
  const ws = tmp('ro');
  const code = `
    const fs = require('fs');
    const attempt = (p) => { try { fs.writeFileSync(p, 'x'); return 'WROTE'; } catch (e) { return e.code; } };
    console.log(JSON.stringify({
      root: attempt('/pwned'), etc: attempt('/etc/pwned'), usr: attempt('/usr/pwned'), home: attempt('/home/node/pwned'),
      tmp: attempt('/tmp/ok'), work: attempt('/work/ok'),
    }));`;
  const r = await runInSandbox({ workspace: ws, argv: node(code) });
  const out = JSON.parse(r.stdout);
  for (const k of ['root', 'etc', 'usr', 'home']) assert.ok(['EROFS', 'EACCES', 'EPERM'].includes(out[k]), `${k}: ${out[k]}`);
  assert.equal(out.tmp, 'WROTE', '/tmp is a tmpfs scratch area');
  assert.equal(out.work, 'WROTE');
  assert.ok(fs.existsSync(path.join(ws, 'ok')));
});

dockerTest('a sibling directory of the workspace on the host is not visible inside the container', async () => {
  const parent = tmp('sibling');
  const ws = path.join(parent, 'ws');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'host secret');
  const r = await runInSandbox({ workspace: ws, argv: node("const fs=require('fs');console.log(fs.existsSync('/work/../secret.txt'), fs.readdirSync('/').includes('secret.txt'))") });
  assert.equal(r.stdout.trim(), 'false false');
});

dockerTest('timeout kills the container (not just the docker client)', async () => {
  const ws = tmp('timeout');
  const started = Date.now();
  const r = await runInSandbox({ workspace: ws, argv: node('setInterval(()=>{},1000)'), timeoutMs: 2500 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 30_000, 'returned promptly after the timeout');
  assert.equal(containerExists(r.container), false, 'no container left running');
});

dockerTest('abort signal kills the container', async () => {
  const ws = tmp('abort');
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 2500);
  const r = await runInSandbox({ workspace: ws, argv: node('setInterval(()=>{},1000)'), timeoutMs: 60_000, signal: ctl.signal });
  assert.equal(r.aborted, true);
  assert.equal(containerExists(r.container), false);
});

dockerTest('memory limit is enforced: a 1 GB allocation loop is killed, the host is unaffected', async () => {
  const ws = tmp('mem');
  const r = await runInSandbox({ workspace: ws, argv: node('const keep=[];for(;;){keep.push(Buffer.alloc(16*1024*1024,1))}'), timeoutMs: 60_000 });
  assert.ok(r.exitCode === 137 || r.exitCode === 134, `exit code ${r.exitCode} (137 = OOM kill, 134 = abort)`);
  assert.equal(r.timedOut, false);
});

dockerTest('pids limit: a fork bomb is capped at the limit instead of exhausting the host', async () => {
  const ws = tmp('pids');
  const code = `
    const { spawn } = require('child_process');
    let spawned = 0, failed = 0;
    for (let i = 0; i < 300; i++) {
      const c = spawn('sleep', ['5'], { stdio: 'ignore' });
      c.on('spawn', () => { spawned++; });
      c.on('error', () => { failed++; });
    }
    setTimeout(() => { console.log(JSON.stringify({ spawned, failed })); process.exit(0); }, 2000);`;
  const r = await runInSandbox({ workspace: ws, argv: node(code), timeoutMs: 40_000 });
  const out = JSON.parse(r.stdout);
  assert.ok(out.spawned < 128, `spawned ${out.spawned} children under a pids limit of 128`);
  assert.ok(out.failed > 0, 'some spawns were refused');
  assert.equal(containerExists(r.container), false);
});

dockerTest('output beyond the cap is truncated and the container is killed', async () => {
  const ws = tmp('output');
  const r = await runInSandbox({ workspace: ws, argv: node("for(;;)process.stdout.write('x'.repeat(65536))"), maxOutputBytes: 100_000, timeoutMs: 60_000 });
  assert.equal(r.truncated, true);
  assert.equal(containerExists(r.container), false);
});

dockerTest('runs as the unprivileged user with no capabilities', async () => {
  const ws = tmp('user');
  const r = await runInSandbox({ workspace: ws, argv: node("console.log(process.getuid(), require('fs').readFileSync('/proc/self/status','utf8').match(/CapEff:\\s+(\\w+)/)[1])") });
  assert.equal(r.stdout.trim(), '1000 0000000000000000');
});

dockerTest('the host environment (and any API key) is not visible inside', async () => {
  const ws = tmp('envleak');
  const r = await runInSandbox({ workspace: ws, argv: node(`console.log(Object.keys(process.env).filter((k) => /WARRANT|GEMINI|KEY/.test(k)).join(','))`) });
  assert.equal(r.stdout.trim(), '');
});

// ---------------------------------------------------------------- copy mode: no host directory is mounted (F4, F11, F13, F14, I5)

test('copy mode arguments: no bind mount, a size- and inode-limited /work, file size and descriptor limits, a label, an init process', () => {
  const { DEFAULTS, LABEL } = require('../src/sandbox/docker');
  const args = buildDockerArgs({ name: 'warrant-x', argv: ['node', '--test'], mode: 'copy', bootOptions: { proto: false, deadlineMs: 1000, maxBundle: 10, maxStderr: 10 } });
  const flat = args.join(' ');
  assert.ok(!args.includes('--mount') && !flat.includes('type=bind'), 'nothing from the host is mounted');
  assert.ok(flat.includes(`/work:rw,nosuid,size=${DEFAULTS.workSize},nr_inodes=${DEFAULTS.workInodes}`), 'a limited tmpfs at /work');
  for (const needle of ['--network none', '--read-only', '--cap-drop ALL', 'no-new-privileges', '--init', `--label ${LABEL}`, `fsize=${DEFAULTS.fileSizeLimit}`, `nofile=${DEFAULTS.openFiles}`, '--pids-limit 128']) assert.ok(flat.includes(needle), `missing ${needle}`);
  assert.deepEqual(args.slice(-5, -2), ['node:22-alpine', 'node', '-e']);
  const bind = buildDockerArgs({ name: 'warrant-x', workspace: tmp('args2'), argv: ['node'] });
  assert.ok(bind.join(' ').includes('fsize=') && bind.includes('--init'), 'the legacy bind mode is bounded too');
});

test('WARRANT_SANDBOX_IMAGE pins the image without touching code; the default tag is unchanged', () => {
  const { DEFAULT_IMAGE, resolveImage } = require('../src/sandbox/docker');
  assert.equal(DEFAULT_IMAGE, 'node:22-alpine');
  assert.equal(resolveImage(), 'node:22-alpine');
  const saved = process.env.WARRANT_SANDBOX_IMAGE;
  const pinned = `node:22-alpine@sha256:${'a'.repeat(64)}`;
  process.env.WARRANT_SANDBOX_IMAGE = pinned;
  try {
    assert.equal(resolveImage(), pinned);
    assert.ok(buildDockerArgs({ name: 'n', argv: ['x'], mode: 'copy', bootOptions: {} }).includes(pinned));
  } finally {
    if (saved === undefined) delete process.env.WARRANT_SANDBOX_IMAGE; else process.env.WARRANT_SANDBOX_IMAGE = saved;
  }
});

dockerTest('copy mode: the files arrive in /work, and what the command writes there never reaches the host directory', async () => {
  const ws = tmp('copy');
  fs.writeFileSync(path.join(ws, 'in.txt'), 'hello from host');
  const r = await runInSandbox({ workspace: ws, mode: 'copy', argv: node("const fs=require('fs');process.stdout.write(fs.readFileSync('in.txt','utf8')+'|'+process.cwd());fs.writeFileSync('out.txt','from container');process.exit(3)") });
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout, 'hello from host|/work');
  assert.deepEqual(fs.readdirSync(ws), ['in.txt'], 'the host directory is untouched');
  assert.equal(containerExists(r.container), false);
});

dockerTest('F11: the container can not see any host path - mountinfo holds no user name and no temp directory', async () => {
  const ws = tmp('mountinfo');
  const r = await runInSandbox({ workspace: ws, mode: 'copy', argv: node("process.stdout.write(require('fs').readFileSync('/proc/self/mountinfo','utf8'))") });
  assert.equal(r.exitCode, 0);
  const user = os.userInfo().username;
  assert.ok(user.length > 0 && !r.stdout.includes(user), 'the Windows/Unix user name is not in mountinfo');
  assert.ok(!r.stdout.includes(os.tmpdir()) && !r.stdout.includes(ws), 'no host path is in mountinfo');
  assert.ok(!/ (?:9p|virtiofs|grpcfuse|fuse\.[a-z]+) /.test(r.stdout.split('\n').filter((l) => / \/work /.test(l)).join('\n')), '/work is not a host share');
  assert.match(r.stdout, / \/work .* - tmpfs /, '/work is a tmpfs');
});

dockerTest('F4: a 300 MB writer is stopped by the file size limit, 20000 files by the inode limit, and the host disk sees nothing', async () => {
  const ws = tmp('disk');
  const code = `
    const fs = require('fs');
    const out = {};
    try { const fd = fs.openSync('big.bin', 'w'); const chunk = Buffer.alloc(1 << 20, 1); for (let i = 0; i < 300; i++) fs.writeSync(fd, chunk); out.big = 'WROTE'; } catch (e) { out.big = e.code; }
    out.bigSize = fs.existsSync('big.bin') ? fs.statSync('big.bin').size : 0;
    let made = 0; try { for (let i = 0; i < 20000; i++) { fs.writeFileSync('f' + i, 'x'); made++; } } catch (e) { out.files = e.code; }
    out.made = made;
    process.stdout.write(JSON.stringify(out));`;
  const r = await runInSandbox({ workspace: ws, mode: 'copy', argv: node(code), timeoutMs: 60_000 });
  const out = JSON.parse(r.stdout);
  assert.notEqual(out.big, 'WROTE', 'the 300 MB write must fail');
  assert.ok(out.bigSize <= 16 * 1024 * 1024, `big.bin is ${out.bigSize} bytes`);
  assert.ok(out.made < 20000 && out.files === 'ENOSPC', `files made ${out.made}, error ${out.files}`);
  assert.deepEqual(fs.readdirSync(ws), [], 'nothing was written on the host');
});

dockerTest('F14: the container ends by itself at its own deadline even if the process that started it is gone, and a sweep removes leftovers by name prefix', async () => {
  const { spawn } = require('node:child_process');
  const { encodeBundle } = require('../src/sandbox/bundle');
  const { sweepStale, spawnSandbox } = require('../src/sandbox/docker');
  const name = `warrant-deadline-${process.pid}-${Date.now()}`;
  const args = buildDockerArgs({ name, argv: node('setInterval(()=>{},1000)'), mode: 'copy', bootOptions: { proto: false, deadlineMs: 4000, maxBundle: 1 << 20, maxStderr: 1000 } });
  const client = spawn('docker', args, { stdio: ['pipe', 'ignore', 'ignore'], env: dockerEnv(), windowsHide: true });
  client.stdin.write(encodeBundle([]));
  client.stdin.end();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(containerExists(name), true, 'the container is running');
  client.kill(); // the orchestrator dies: no timeout, no rm -f from the host
  const until = Date.now() + 20_000;
  while (containerExists(name) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(containerExists(name), false, 'the in-container deadline ended it');

  // a leftover with a long deadline is found by the sweep, by name prefix only, and only when old enough
  const prefix = `warrant-sweeptest-${process.pid}-`;
  const handle = spawnSandbox({ argv: node('setInterval(()=>{},1000)'), files: [], timeoutMs: 120_000, name: `${prefix}a` });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(containerExists(`${prefix}a`), true);
  assert.deepEqual(sweepStale({ olderThanMs: 24 * 3600_000, namePrefix: prefix }).removed, [], 'a young container is left alone');
  assert.equal(sweepStale({ olderThanMs: 0, namePrefix: prefix }).removed.length, 1);
  assert.equal(containerExists(`${prefix}a`), false);
  await handle.result;
});

dockerTest('imageInfo reports the content id and, when the image has one, the repository digest', () => {
  const { imageInfo } = require('../src/sandbox/docker');
  const info = imageInfo();
  assert.equal(info.image, 'node:22-alpine');
  assert.match(info.id, /^sha256:[a-f0-9]{64}$/);
  if (info.digest) assert.match(info.digest, /@sha256:[a-f0-9]{64}$/);
});

// ---------------------------------------------------------------- the container slots are shared by every process

test('slots: at most N holders at once across processes, a dead holder\'s slot is reclaimed, and two requests for two slots do not deadlock', async () => {
  const { spawn } = require('node:child_process');
  const { SlotPool } = require('../src/sandbox/slots');
  const dir = tmp('slots');
  const script = `
    const { SlotPool } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'sandbox', 'slots.js'))});
    const pool = new SlotPool({ dir: process.argv[1], limit: 2, pollMs: 20 });
    (async () => {
      const want = Number(process.argv[2]);
      const release = await pool.acquire(want);
      process.stdout.write('IN ' + want + ' ' + Date.now() + String.fromCharCode(10));
      await new Promise((r) => setTimeout(r, 300));
      process.stdout.write('OUT ' + want + ' ' + Date.now() + String.fromCharCode(10));
      release();
    })();`;
  const runs = [2, 2, 1, 1, 2].map((want) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script, dir, String(want)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', () => resolve(out.trim().split('\n').map((l) => l.split(' '))));
  }));
  const events = (await Promise.all(runs)).flat();
  assert.equal(events.length, 10, 'every process got its slots and gave them back');
  let held = 0;
  for (const [kind, want] of events.map((e) => [e[0], Number(e[1]), Number(e[2])]).sort((a, b) => a[2] - b[2] || (a[0] === 'OUT' ? -1 : 1)).map((e) => [e[0], e[1]])) {
    held += kind === 'IN' ? want : -want;
    assert.ok(held <= 2, 'never more than 2 slots held at once');
  }

  fs.writeFileSync(path.join(dir, 'slot-0'), '2000000000'); // a holder that no longer exists
  const pool = new SlotPool({ dir, limit: 2, pollMs: 20 });
  const release = await Promise.race([pool.acquire(2), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  assert.ok(release, 'the stale slot was reclaimed');
  release();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('slot-')), [], 'everything released');
});

dockerTest('code under test that prints a docker daemon error is judged, not mistaken for an infrastructure failure', async () => {
  const ws = tmp('fake-infra');
  const r = await runInSandbox({ workspace: ws, mode: 'copy', argv: node("process.stderr.write('docker: Error response from daemon: Conflict.' + String.fromCharCode(10) + 'fatal error: runtime: cannot allocate memory' + String.fromCharCode(10)); process.exit(1)") });
  assert.equal(r.exitCode, 1);
  assert.equal(r.spawnError, null, "the run counts as the code's own result");
  assert.match(r.stderr, /Error response from daemon/);
  assert.ok(!r.stderr.includes('@@warrant-boot'), 'the marker is not part of the output');
});
