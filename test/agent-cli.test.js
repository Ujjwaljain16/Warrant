'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRunSpec } = require('../src/core/spec');
const { checkRequirement } = require('../src/core/verifiers');
const { main } = require('../src/cli/main');

const EXAMPLE = path.resolve(__dirname, '..', 'examples', 'agent-cli');

function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `warrant-agentcli-${name}-`)); }
function cli(argv, cwd) {
  let out = '';
  let err = '';
  return main(argv, { cwd, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } }).then((code) => ({ code, out, err }));
}
const baseTask = (exec) => ({ id: 't', deps: [], effect: 'pure', deadline_ms: 1000, max_attempts: 1, outputs: ['o'], requirements: [], trust_worker: true, exec });
const spec = (exec) => ({ spec_version: '1', run_id: 'r', max_concurrency: 1, tasks: [baseTask(exec)] });

test('spec: exec.env takes a short list of variable names and nothing else', () => {
  assert.equal(validateRunSpec(spec({ argv: ['x'], env: ['HOME', 'ANTHROPIC_API_KEY'] })).ok, true);
  for (const env of ['HOME', ['HOME', 'HOME'], ['1BAD'], ['A=B'], [''], Array.from({ length: 33 }, (_, i) => `V${i}`), [42]]) {
    assert.equal(validateRunSpec(spec({ argv: ['x'], env })).ok, false, JSON.stringify(env));
  }
});

test('worker: only the variables named in exec.env reach the command, besides the scrubbed basics', async () => {
  const cwd = tmp('env');
  process.env.WARRANT_TEST_ALLOWED = 'yes';
  process.env.WARRANT_TEST_SECRET = 'must-not-leak';
  try {
    const script = "require('fs').writeFileSync('o', JSON.stringify({a: process.env.WARRANT_TEST_ALLOWED || null, s: process.env.WARRANT_TEST_SECRET || null}))";
    const s = spec({ argv: ['node', '-e', script], env: ['WARRANT_TEST_ALLOWED'] });
    fs.writeFileSync(path.join(cwd, 'spec.json'), JSON.stringify(s));
    const run = await cli(['run', 'spec.json', '--dir', 'w'], cwd);
    assert.equal(run.code, 0, run.err);
    const attempts = path.join(cwd, 'w', 'attempts', 'r');
    const out = JSON.parse(fs.readFileSync(path.join(attempts, fs.readdirSync(attempts)[0], 'o'), 'utf8'));
    assert.deepEqual(out, { a: 'yes', s: null });
  } finally {
    delete process.env.WARRANT_TEST_ALLOWED;
    delete process.env.WARRANT_TEST_SECRET;
  }
});

test('command requirement: ./ arguments resolve against the spec directory when one is given, and are left alone otherwise', async () => {
  const specDir = tmp('specdir');
  const workDir = tmp('work');
  fs.writeFileSync(path.join(specDir, 'check.js'), 'process.exit(0)');
  const req = { id: 'c', kind: 'command', argv: ['node', './check.js'], timeout_ms: 10000 };
  assert.equal((await checkRequirement(req, { workDir, specDir })).status, 'pass');
  assert.notEqual((await checkRequirement(req, { workDir })).status, 'pass', 'without a spec directory ./check.js is looked up in the work directory');
});

test('example: of two agents that both say "done" and both pass the visible tests, only the careful one passes the gate', async () => {
  const cwd = tmp('example');
  const run = await cli(['run', path.join(EXAMPLE, 'spec.json'), '--dir', 'w'], cwd);
  assert.equal(run.code, 1, run.err);
  const report = JSON.parse(run.out);
  assert.equal(report.tasks['careful-agent'].status, 'succeeded');
  assert.deepEqual(report.tasks['careful-agent'].verification.passed, ['visible-tests', 'hidden-tests']);
  assert.equal(report.tasks['hasty-agent'].status, 'failed');
  assert.deepEqual(report.tasks['hasty-agent'].verification.passed, ['visible-tests']);
  assert.deepEqual(report.tasks['hasty-agent'].verification.failed, ['hidden-tests']);
  // the hidden tests were never copied where the agent works
  const attempts = path.join(cwd, 'w', 'attempts', 'agent-cli-offline');
  for (const dir of fs.readdirSync(attempts)) {
    const files = fs.readdirSync(path.join(attempts, dir));
    assert.ok(!files.some((f) => f.includes('hidden')), `${dir}: ${files.join(', ')}`);
    assert.ok(files.includes('visible.test.js') && files.includes('prompt.md'));
  }
});

test('example: the live Claude Code spec is valid and passes only the variables it names', () => {
  const live = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'spec-claude-code.json'), 'utf8'));
  assert.equal(validateRunSpec(live).ok, true);
  const exec = live.tasks[0].exec;
  assert.ok(exec.argv.includes('{prompt}'));
  assert.ok(exec.env.includes('ANTHROPIC_API_KEY'));
  assert.ok(!JSON.stringify(live).includes('hidden/') || live.tasks[0].requirements.some((r) => r.argv.join(' ').includes('./hidden/')), 'hidden tests only appear as a requirement');
});
