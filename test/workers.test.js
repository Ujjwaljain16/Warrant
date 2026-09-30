'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Engine } = require('../src/engine/engine');
const { MemoryRunLog } = require('../src/log/runlog');
const { auditLog } = require('../src/engine/replay');
const { CommandWorker } = require('../src/workers/command-worker');
const { main } = require('../src/cli/main');
const { sha } = require('./helpers');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-${p}-`));
const node = (code) => ['node', '-e', code];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function claimOnlyTask(id, code, extra = {}) {
  return { id, deps: [], effect: 'pure', deadline_ms: 5000, max_attempts: 2, outputs: ['out'], requirements: [], trust_worker: true, exec: { argv: node(code) }, ...extra };
}

async function runReal(tasks, { workerOpts = {}, signal, onEngine } = {}) {
  const baseDir = tmp('attempts');
  const worker = new CommandWorker({ baseDir, ...workerOpts });
  const log = new MemoryRunLog();
  const spec = { spec_version: '1', run_id: 'run-real', max_concurrency: 2, tasks };
  const engine = new Engine(spec, { worker, log, workDirFor: (a) => worker.workDirFor(a), signal });
  if (onEngine) onEngine(engine);
  const report = await engine.run();
  return { report, baseDir, log, spec, worker, violations: auditLog(engine.spec, log.entries()) };
}

test('real subprocess: output is read back from the attempt directory and gated against the pinned digest', async () => {
  const content = '{"hello":"world"}';
  const task = {
    ...claimOnlyTask('a', `require('fs').writeFileSync('out', ${JSON.stringify(content)})`),
    requirements: [{ id: 'exact', kind: 'artifact_sha256', artifact: 'out', sha256: sha(content) }], trust_worker: undefined,
  };
  delete task.trust_worker;
  const { report, violations } = await runReal([task]);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.a.verification.level, 'gated');
  assert.deepEqual(violations, []);
});

test('real subprocess: exit code 0 with wrong content is a failure; the dependent task never executes', async () => {
  const liar = {
    id: 'a', deps: [], effect: 'pure', deadline_ms: 5000, max_attempts: 2, outputs: ['out'],
    exec: { argv: node("require('fs').writeFileSync('out','all good, trust me')") },
    requirements: [{ id: 'exact', kind: 'artifact_sha256', artifact: 'out', sha256: sha('the real answer') }],
  };
  const dependent = claimOnlyTask('b', "require('fs').writeFileSync('marker','ran')", { deps: ['a'] });
  const { report, baseDir, violations } = await runReal([liar, dependent]);
  assert.equal(report.tasks.a.status, 'failed');
  assert.equal(report.tasks.a.code, 'GATE_FAILED');
  assert.equal(report.tasks.b.status, 'blocked');
  assert.equal(fs.existsSync(path.join(baseDir, 'run-real', 'b.1')), false, 'no attempt directory was even created for b');
  assert.deepEqual(violations, []);
});

test('real subprocess: non-zero exit is retried up to the budget, then fails with ATTEMPTS_EXHAUSTED', async () => {
  const { report } = await runReal([claimOnlyTask('a', 'process.exit(7)', { max_attempts: 3 })]);
  assert.equal(report.tasks.a.status, 'failed');
  assert.equal(report.tasks.a.code, 'ATTEMPTS_EXHAUSTED');
  assert.equal(report.tasks.a.attempts, 3);
});

test('real subprocess: a hung process is killed at its deadline (the process is actually gone) and the run completes', async () => {
  const pidFile = path.join(tmp('pid'), 'pid.txt');
  const code = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  const started = Date.now();
  const { report } = await runReal([claimOnlyTask('a', code, { deadline_ms: 700, max_attempts: 1 })]);
  assert.equal(report.tasks.a.status, 'failed');
  assert.ok(Date.now() - started < 8000, 'the run is bounded by the deadline, not by the child');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(report.unquiesced_workers, 0, 'the run did not report finished while the child was still running');
  assert.equal(alive(pid), false, 'hung child must have been killed');
});

test('real subprocess: cancelling the run kills the child before it can produce its effect', async () => {
  const marker = path.join(tmp('marker'), 'effect.txt');
  const code = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'effect'), 1500); setInterval(() => {}, 1000)`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 400);
  const { report } = await runReal([claimOnlyTask('a', code, { deadline_ms: 20000 })], { signal: controller.signal });
  assert.equal(report.status, 'cancelled');
  assert.equal(report.tasks.a.status, 'cancelled');
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fs.existsSync(marker), false, 'the effect must never happen after cancellation');
});

test('real subprocess: the environment is scrubbed, so parent secrets are not visible to workers', async () => {
  process.env.WARRANT_TEST_SECRET = 'hunter2-should-not-leak';
  try {
    const { report, baseDir } = await runReal([claimOnlyTask('a', "require('fs').writeFileSync('out', JSON.stringify(process.env))")]);
    assert.equal(report.tasks.a.status, 'succeeded');
    const dump = fs.readFileSync(path.join(baseDir, 'run-real', 'a.1', 'out'), 'utf8');
    assert.ok(!dump.includes('hunter2-should-not-leak'), 'secret must not reach the child');
    assert.ok(!dump.includes('WARRANT_TEST_SECRET'));
    const env = JSON.parse(dump);
    assert.equal(env.WARRANT_TASK, 'a');
    assert.equal(env.WARRANT_ATTEMPT, '1');
  } finally {
    delete process.env.WARRANT_TEST_SECRET;
  }
});

test('real subprocess: output flooding is cut off and is a non-retryable failure', async () => {
  const flood = "const b = 'x'.repeat(65536); for (let i = 0; i < 200; i++) process.stdout.write(b)";
  const { report } = await runReal([claimOnlyTask('a', flood, { max_attempts: 3 })], { workerOpts: { maxOutputBytes: 100_000 } });
  assert.equal(report.tasks.a.status, 'failed');
  assert.equal(report.tasks.a.code, 'OUTPUT_LIMIT');
  assert.equal(report.tasks.a.attempts, 1, 'a flood is not worth retrying');
});

test('real subprocess: a missing executable fails once without retries', async () => {
  const task = { ...claimOnlyTask('a', ''), exec: { argv: ['definitely-not-a-real-binary-xyz'] }, max_attempts: 3 };
  const { report } = await runReal([task]);
  assert.equal(report.tasks.a.status, 'failed');
  assert.equal(report.tasks.a.code, 'SPAWN_ERROR');
  assert.equal(report.tasks.a.attempts, 1);
});

test('real subprocess: a symlinked output is refused rather than followed', async (t) => {
  const secretDir = tmp('secret');
  const secret = path.join(secretDir, 'private.txt');
  fs.writeFileSync(secret, 'top secret host file');
  const code = `try { require('fs').symlinkSync(${JSON.stringify(secret)}, 'out') } catch (e) { process.exit(42) }`;
  const { report } = await runReal([claimOnlyTask('a', code, { max_attempts: 1 })]);
  if (report.tasks.a.code === 'EXIT_NONZERO' || report.tasks.a.code === 'ATTEMPTS_EXHAUSTED') {
    if (report.tasks.a.attempts === 1 && report.tasks.a.status === 'failed') {
      // Could be the platform refusing to create symlinks (needs privilege on Windows) or our refusal; both are safe.
      t.diagnostic('symlink creation unavailable or refused; either way the host file was not read');
    }
  }
  assert.notEqual(report.tasks.a.status, 'succeeded', 'the symlinked host file must never become an accepted artifact');
});

test('real subprocess: relative ./ arguments resolve against the spec directory only when one is configured', async () => {
  const specDir = tmp('specdir');
  fs.writeFileSync(path.join(specDir, 'write.js'), "require('fs').writeFileSync('out','from spec dir')");
  const task = { ...claimOnlyTask('a', ''), exec: { argv: ['node', './write.js'] } };
  const withDir = await runReal([task], { workerOpts: { specDir } });
  assert.equal(withDir.report.tasks.a.status, 'succeeded');
  const without = await runReal([task]);
  assert.equal(without.report.tasks.a.status, 'failed', './write.js is resolved against the attempt dir, where it does not exist');
});

// ----------------------------------------------------------------------------- CLI, end to end

function cli(argv, cwd) {
  let out = '';
  let err = '';
  return main(argv, { cwd, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } }).then((code) => ({ code, out, err }));
}

const EXAMPLE = path.resolve(__dirname, '..', 'examples', 'pipeline');

test('CLI: the shipped example succeeds, writes a log that verifies, and detects tampering afterwards', async () => {
  const cwd = tmp('cli');
  const run = await cli(['run', path.join(EXAMPLE, 'spec.json'), '--dir', 'work'], cwd);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  assert.equal(report.status, 'succeeded');
  assert.deepEqual(Object.values(report.tasks).map((t) => t.code), ['VERIFIED', 'VERIFIED', 'VERIFIED']);
  const logFile = path.join(cwd, 'work', 'run-pipeline', 'run.log');
  const verify = await cli(['verify-log', logFile, '--spec', path.join(EXAMPLE, 'spec.json')], cwd);
  assert.equal(verify.code, 0, verify.err);
  assert.deepEqual(JSON.parse(verify.out).violations, []);
  const lines = fs.readFileSync(logFile, 'utf8').split('\n');
  lines[3] = lines[3].replace(/"t":\d+/, '"t":1');
  fs.writeFileSync(logFile, lines.join('\n'));
  const tampered = await cli(['verify-log', logFile], cwd);
  assert.equal(tampered.code, 1);
});

test('CLI: run refuses an existing log (resume continues it), and the two shipped examples keep separate logs', async () => {
  const cwd = tmp('cli-twice');
  const spec = path.join(EXAMPLE, 'spec.json');
  assert.equal((await cli(['run', spec, '--dir', 'work'], cwd)).code, 0);
  const again = await cli(['run', spec, '--dir', 'work'], cwd);
  assert.equal(again.code, 2);
  assert.match(again.err, /already exists/);
  assert.match(again.err, /resume/);
  // the honest and the lying pipeline run one after the other in the same directory, as the README shows, and the first log still verifies
  assert.equal((await cli(['run', path.join(EXAMPLE, 'spec-lying.json'), '--dir', 'work'], cwd)).code, 1);
  const verify = await cli(['verify-log', path.join(cwd, 'work', 'run-pipeline', 'run.log'), '--spec', spec], cwd);
  assert.equal(verify.code, 0, verify.out);
});

test('CLI: the lying example exits non-zero and says which gate failed', async () => {
  const cwd = tmp('cli-lie');
  const run = await cli(['run', path.join(EXAMPLE, 'spec-lying.json'), '--dir', 'work'], cwd);
  assert.equal(run.code, 1);
  const report = JSON.parse(run.out);
  assert.equal(report.tasks.sort.code, 'GATE_FAILED');
  assert.deepEqual(report.tasks.sort.verification.failed.sort(), ['exact', 'is-sorted']);
  assert.equal(report.tasks.summarize.status, 'blocked');
});

test('CLI: usage and input errors exit 2 with a message and never a stack trace', async () => {
  const cwd = tmp('cli-bad');
  fs.writeFileSync(path.join(cwd, 'bad.json'), '{"spec_version":"1"}');
  fs.writeFileSync(path.join(cwd, 'notjson.json'), '{{{');
  for (const argv of [['run'], ['run', 'missing.json'], ['run', 'notjson.json'], ['run', 'bad.json'], ['frobnicate'], ['run', 'bad.json', '--wat', '1'], ['run', 'bad.json', '--concurrency']]) {
    const r = await cli(argv, cwd);
    assert.equal(r.code, 2, `${argv.join(' ')} -> ${r.code}`);
    assert.match(r.err, /error:/);
    assert.ok(!/\n\s+at /.test(r.err), 'no stack trace');
  }
  const noResumeLog = await cli(['resume', path.join(EXAMPLE, 'spec.json')], cwd);
  assert.equal(noResumeLog.code, 2);
  assert.match(noResumeLog.err, /requires --log/);
});

test('CLI: resume continues an interrupted run from its log without redoing finished work', async () => {
  const cwd = tmp('cli-resume');
  const specFile = path.join(EXAMPLE, 'spec.json');
  const first = await cli(['run', specFile, '--dir', 'work'], cwd);
  assert.equal(first.code, 0);
  const logFile = path.join(cwd, 'work', 'run-pipeline', 'run.log');
  // Cut the log back to just after `sort` was accepted, as if the process died there.
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  const cut = lines.findIndex((l) => l.includes('"task":"sort"') && l.includes('"task_settled"'));
  assert.ok(cut > 0);
  fs.writeFileSync(logFile, `${lines.slice(0, cut + 1).join('\n')}\n`);
  const resumed = await cli(['resume', specFile, '--log', logFile, '--dir', 'work'], cwd);
  assert.equal(resumed.code, 0, resumed.err);
  const report = JSON.parse(resumed.out);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.fetch.attempts, 1);
  assert.equal(report.tasks.sort.attempts, 1, 'finished work is not redone');
  assert.equal(report.tasks.summarize.attempts, 1);
  const again = await cli(['resume', specFile, '--log', logFile, '--dir', 'work'], cwd);
  assert.equal(again.code, 2, 'a finished run cannot be resumed again');
  assert.match(again.err, /RUN_FINISHED/);
});

// ---------------------------------------------------------------- F2: downstream tasks consume the verified bytes

test('real subprocess: a process left running by an accepted task can not change what a dependent task reads', async () => {
  const good = 'GOOD';
  const producer = {
    id: 'a', deps: [], effect: 'pure', deadline_ms: 8000, max_attempts: 1, outputs: ['out'],
    requirements: [{ id: 'exact', kind: 'artifact_sha256', artifact: 'out', sha256: sha(good) }],
    exec: { argv: node(`
      const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
      fs.writeFileSync('out', ${JSON.stringify(good)});
      const target = path.resolve('out');
      spawn(process.execPath, ['-e', 'setTimeout(() => require("fs").writeFileSync(process.argv[1], "EVIL"), 1200)', target], { detached: true, stdio: 'ignore' }).unref();`) },
  };
  const consumer = claimOnlyTask('b', `
    const fs = require('fs'); const path = require('path');
    setTimeout(() => {
      const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
      fs.writeFileSync('out', fs.readFileSync(path.join(input.dep_dirs.a, 'out'), 'utf8'));
    }, 2600);`, { deps: ['a'], deadline_ms: 8000, max_attempts: 1 });
  const { report, baseDir, violations } = await runReal([producer, consumer]);
  assert.equal(report.status, 'succeeded');
  assert.deepEqual(violations, []);
  assert.equal(fs.readFileSync(path.join(baseDir, 'run-real', 'a.1', 'out'), 'utf8'), 'EVIL', 'the lingering process did rewrite the producer\'s own file');
  assert.equal(fs.readFileSync(path.join(baseDir, 'run-real', 'b.1', 'out'), 'utf8'), good, 'the consumer still read the verified bytes');
});

test('real subprocess: without the verified bytes (after a resume) a dependency is re-read and checked against the recorded digest', () => {
  const baseDir = tmp('dep');
  const worker = new CommandWorker({ baseDir });
  const attemptDir = path.join(baseDir, 'r', 'a.1');
  fs.mkdirSync(attemptDir, { recursive: true });
  fs.writeFileSync(path.join(attemptDir, 'out'), 'GOOD');
  const { digestArtifacts } = require('../src/core/gate');
  const info = { runId: 'r', depAttempts: { a: 'a.1' }, deps: { a: { attempt: 'a.1', digest: digestArtifacts({ out: 'GOOD' }), outputs: ['out'], artifacts: null } } };
  const consumerDir = path.join(baseDir, 'r', 'b.1');
  fs.mkdirSync(consumerDir, { recursive: true });
  const ok = worker._freezeDependencies(info, consumerDir);
  assert.equal(fs.readFileSync(path.join(ok.dirs.a, 'out'), 'utf8'), 'GOOD');
  fs.writeFileSync(path.join(attemptDir, 'out'), 'EVIL');
  assert.equal(worker._freezeDependencies(info, path.join(baseDir, 'r', 'c.1')).error, 'DEP_CHANGED');
  fs.rmSync(path.join(attemptDir, 'out'));
  assert.equal(worker._freezeDependencies(info, path.join(baseDir, 'r', 'd.1')).error, 'DEP_MISSING');
});
