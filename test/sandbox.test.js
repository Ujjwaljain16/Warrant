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
