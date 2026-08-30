'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('../src/util/proc');
const { CommandWorker } = require('../src/workers/command-worker');

// Platform-sensitive behaviour of the subprocess layer. These run on every platform; the process-group kill (POSIX) and
// the `taskkill /T` path (Windows) are different code, so the same assertions have to hold for both.

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-${p}-`));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

test('process tree: aborting a command kills its grandchildren too, not only the direct child', async () => {
  const pidFile = path.join(tmp('tree'), 'pids.json');
  const code = [
    "const { spawn } = require('node:child_process');",
    "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    `require('node:fs').writeFileSync(${JSON.stringify(`${pidFile}.tmp`)}, JSON.stringify({ child: process.pid, grandchild: g.pid }));`,
    `require('node:fs').renameSync(${JSON.stringify(`${pidFile}.tmp`)}, ${JSON.stringify(pidFile)});`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const controller = new AbortController();
  const running = runProcess({ argv: ['node', '-e', code], cwd: os.tmpdir(), timeoutMs: 30_000, signal: controller.signal });
  assert.ok(await until(() => fs.existsSync(pidFile), 10_000), 'the child started and reported its pids');
  const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(alive(pids.child) && alive(pids.grandchild), 'both processes are running before the abort');
  controller.abort();
  const result = await running;
  assert.equal(result.aborted, true);
  assert.ok(await until(() => !alive(pids.child), 5000), 'direct child is gone');
  assert.ok(await until(() => !alive(pids.grandchild), 5000), 'grandchild is gone: the whole tree was killed');
});

test('process tree: a deadline kill also reaches grandchildren', async () => {
  const pidFile = path.join(tmp('tree-timeout'), 'pids.json');
  const code = [
    "const { spawn } = require('node:child_process');",
    "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const result = await runProcess({ argv: ['node', '-e', code], cwd: os.tmpdir(), timeoutMs: 1500 });
  assert.equal(result.timedOut, true);
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(await until(() => !alive(grandchild), 5000), 'grandchild is gone after the timeout');
});

test('process tree: output flooding kills the tree that was producing it', async () => {
  const result = await runProcess({
    argv: ['node', '-e', "const b = 'x'.repeat(65536); setInterval(() => process.stdout.write(b), 1)"],
    cwd: os.tmpdir(), timeoutMs: 30_000, maxOutputBytes: 100_000,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.timedOut, false, 'stopped by the output cap, not by the timeout');
});

test('paths: an attempt directory can never leave the base directory, whatever the ids contain', () => {
  const worker = new CommandWorker({ baseDir: tmp('base') });
  assert.throws(() => worker.attemptDir('..', 'a.1'), /escapes the base directory/);
  assert.throws(() => worker.attemptDir('run', '../../x'), /escapes the base directory/);
  const inside = worker.attemptDir('run-1', 'a.1');
  assert.ok(inside.startsWith(worker.baseDir + path.sep));
});

test('paths: ./ and ../ arguments resolve against the spec directory; absolute and bare arguments are left alone', () => {
  const specDir = tmp('specdir');
  const worker = new CommandWorker({ baseDir: tmp('base'), specDir });
  const abs = path.join(os.tmpdir(), 'abs.js');
  assert.deepEqual(worker._resolveArgs(['node', './a.js', '../b.js', abs, 'plain', '--flag=./x']), [
    'node', path.resolve(specDir, 'a.js'), path.resolve(specDir, '../b.js'), abs, 'plain', '--flag=./x',
  ]);
  assert.deepEqual(worker._resolveArgs(['./first.js']), ['./first.js'], 'the executable position is never rewritten');
});

test('symlinks: an output that is a symlink is never read, whether it points to a file or a directory', (t) => {
  const base = tmp('symlink');
  const dir = path.join(base, 'attempt');
  fs.mkdirSync(dir);
  const secret = path.join(base, 'secret.txt');
  fs.writeFileSync(secret, 'host secret');
  try {
    fs.symlinkSync(secret, path.join(dir, 'file-link'));
    fs.symlinkSync(base, path.join(dir, 'dir-link'), 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('this account may not create symlinks (normal on Windows without developer mode)'); return; }
    throw error;
  }
  const worker = new CommandWorker({ baseDir: tmp('base') });
  assert.equal(worker._readOutput(dir, 'file-link'), null);
  assert.equal(worker._readOutput(dir, 'dir-link'), null);
  fs.writeFileSync(path.join(dir, 'regular'), 'ok');
  assert.equal(worker._readOutput(dir, 'regular'), 'ok');
  assert.equal(worker._readOutput(dir, 'missing'), null);
});
