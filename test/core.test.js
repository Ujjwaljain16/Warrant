'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spec, task, sha } = require('./helpers');
const { assertRunSpec, validateRunSpec, SpecError, topologicalOrder } = require('../src/core/spec');
const { STATUS, assertTransition, canTransition, InvalidTransitionError, TRANSITIONS, TERMINAL } = require('../src/core/states');
const { Scheduler } = require('../src/core/scheduler');
const { evaluateGate, isGateVerdict } = require('../src/core/gate');

const errorsOf = (input) => validateRunSpec(input).errors.join(' | ');

test('spec: a valid spec is accepted, normalized and deeply frozen', () => {
  const s = assertRunSpec(spec([task('a'), task('b', { deps: ['a'] })]));
  assert.equal(s.tasks.length, 2);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.tasks[0]) && Object.isFrozen(s.tasks[0].requirements[0]));
});

test('spec: unknown fields, bad ids, cycles and dangling deps are rejected with specific errors', () => {
  assert.match(errorsOf(spec([{ ...task('a'), surprise: 1 }])), /unknown field "surprise"/);
  assert.match(errorsOf(spec([task('Bad Id')])), /id must be an identifier/);
  assert.match(errorsOf(spec([task('a', { deps: ['ghost'] })])), /depends on unknown task ghost/);
  assert.match(errorsOf(spec([task('a', { deps: ['a'] })])), /depends on itself/);
  assert.match(errorsOf(spec([task('a', { deps: ['b'] }), task('b', { deps: ['a'] })])), /cycle/);
  assert.match(errorsOf(spec([task('a'), task('a')])), /unique/);
});

test('spec: a task with no requirements must opt in to claim-only trust explicitly', () => {
  assert.match(errorsOf(spec([task('a', { requirements: [] })])), /trust_worker:true/);
  assert.equal(validateRunSpec(spec([task('a', { requirements: [], trust_worker: true })])).ok, true);
  assert.match(errorsOf(spec([task('a', { trust_worker: true })])), /only valid for a task with no requirements/);
});

test('spec: requirements may only reference declared outputs and must be well formed', () => {
  const bad = task('a', { requirements: [{ id: 'r', kind: 'artifact_sha256', artifact: 'other', sha256: sha('x') }] });
  assert.match(errorsOf(spec([bad])), /not a declared output/);
  assert.match(errorsOf(spec([task('a', { requirements: [{ id: 'r', kind: 'artifact_sha256', artifact: 'out', sha256: 'nothex' }] })])), /64 lowercase hex/);
  assert.match(errorsOf(spec([task('a', { requirements: [{ id: 'r', kind: 'command', argv: [] }] })])), /argv must be/);
  assert.match(errorsOf(spec([task('a', { requirements: [{ id: 'r', kind: 'telepathy' }] })])), /kind must be one of/);
});

test('spec: artifact names that are traversal, device, or platform-ambiguous are rejected', () => {
  for (const name of ['../x', 'a/b', 'a\\b', '..', 'con', 'NUL', 'nul.txt', 'com1', 'lpt9.log', 'out.', 'Out', '.hidden', 'a b', '', 'x'.repeat(65)]) {
    assert.match(errorsOf(spec([task('a', { outputs: [name], requirements: [{ id: 'r', kind: 'artifact_sha256', artifact: name, sha256: sha('x') }] })])), /outputs must be|artifact must be/, `name ${JSON.stringify(name)} must be rejected`);
  }
  for (const name of ['out', 'result.json', 'report-2.txt', 'a_b.c', 'console.log']) {
    assert.equal(validateRunSpec(spec([task('a', { outputs: [name], requirements: [{ id: 'r', kind: 'artifact_sha256', artifact: name, sha256: sha('x') }] })])).ok, true, `${name} is a legitimate name`);
  }
});

test('spec: prototype-pollution keys are rejected anywhere in the document', () => {
  const polluted = JSON.parse('{"spec_version":"1","run_id":"run-x","max_concurrency":1,"tasks":[],"__proto__":{"x":1}}');
  assert.match(errorsOf(polluted), /forbidden key at \$\.__proto__/);
  const nested = JSON.parse(JSON.stringify(spec([task('a')])));
  nested.tasks[0].requirements[0].shape = JSON.parse('{"constructor":"string"}');
  assert.match(errorsOf(nested), /forbidden key/);
  assert.equal({}.x, undefined, 'Object.prototype must remain unpolluted');
});

test('spec: assertRunSpec throws SpecError carrying the error list', () => {
  assert.throws(() => assertRunSpec({}), (e) => e instanceof SpecError && e.code === 'INVALID_SPEC' && e.errors.length > 0);
});

test('spec: topologicalOrder is deterministic and detects cycles', () => {
  const tasks = [task('c', { deps: ['a', 'b'] }), task('a'), task('b', { deps: ['a'] })];
  assert.deepEqual(topologicalOrder(tasks), ['a', 'b', 'c']);
  assert.equal(topologicalOrder([task('x', { deps: ['y'] }), task('y', { deps: ['x'] })]), null);
});

test('states: only declared transitions are legal and terminal states absorb', () => {
  assert.equal(canTransition('pending', 'running'), true);
  assert.equal(canTransition('pending', 'succeeded'), false, 'cannot succeed without running and verifying');
  assert.equal(canTransition('running', 'succeeded'), false, 'running -> succeeded would skip the gate');
  assert.equal(canTransition('verifying', 'succeeded'), true);
  for (const terminal of TERMINAL) assert.deepEqual(TRANSITIONS[terminal], [], `${terminal} must absorb`);
  assert.throws(() => assertTransition('t', 'succeeded', 'running'), (e) => e instanceof InvalidTransitionError && e.from === 'succeeded' && e.to === 'running');
  assert.equal(canTransition('constructor', 'running'), false, 'inherited properties are not states');
});

test('scheduler: dispatch order follows declaration order and respects dependencies', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a'), task('b', { deps: ['a'] }), task('c', { deps: ['a'] }), task('d', { deps: ['b', 'c'] })])));
  assert.deepEqual(s.takeReady(10), ['a']);
  s.transition('a', STATUS.RUNNING);
  s.transition('a', STATUS.VERIFYING);
  s.transition('a', STATUS.SUCCEEDED);
  assert.deepEqual(s.takeReady(1), ['b'], 'limit is honoured');
  assert.deepEqual(s.takeReady(10), ['c']);
  assert.equal(s.readyCount(), 0);
});

test('scheduler: a task with an unmet dependency cannot be dispatched', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a'), task('b', { deps: ['a'] })])));
  assert.throws(() => s.transition('b', STATUS.RUNNING), /unmet dependencies/);
});

test('scheduler: a failed dependency blocks every transitive descendant but not siblings', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a'), task('b', { deps: ['a'] }), task('c', { deps: ['b'] }), task('z')])));
  s.takeReady(10);
  s.transition('a', STATUS.RUNNING);
  s.transition('a', STATUS.FAILED);
  assert.equal(s.statusOf('b'), STATUS.BLOCKED);
  assert.equal(s.statusOf('c'), STATUS.BLOCKED);
  assert.equal(s.statusOf('z'), STATUS.PENDING);
  assert.equal(s.counts.blocked, 2);
});

test('scheduler: counters are driven by guarded transitions, so repeated success is rejected rather than double-counted', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a'), task('b'), task('c', { deps: ['a', 'b'] })])));
  s.takeReady(10);
  for (const id of ['a', 'b']) { s.transition(id, STATUS.RUNNING); }
  s.transition('a', STATUS.VERIFYING);
  s.transition('a', STATUS.SUCCEEDED);
  assert.throws(() => s.transition('a', STATUS.SUCCEEDED), InvalidTransitionError, 'second success delivery must not decrement again');
  assert.equal(s.readyCount(), 0, 'c still waits for b');
  s.transition('b', STATUS.VERIFYING);
  s.transition('b', STATUS.SUCCEEDED);
  assert.deepEqual(s.takeReady(5), ['c']);
});

test('scheduler: retry returns a task to pending and release() makes it dispatchable again', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a')])));
  s.takeReady(1);
  s.transition('a', STATUS.RUNNING);
  s.transition('a', STATUS.PENDING);
  assert.equal(s.readyCount(), 0, 'not ready until released (backoff)');
  s.release('a');
  assert.deepEqual(s.takeReady(1), ['a']);
});

test('scheduler: cancelAll cancels pending and in-flight work and reports what was in flight', () => {
  const s = new Scheduler(assertRunSpec(spec([task('a'), task('b'), task('c', { deps: ['a'] })])));
  s.takeReady(2);
  s.transition('a', STATUS.RUNNING);
  s.transition('b', STATUS.RUNNING);
  s.transition('b', STATUS.VERIFYING);
  const inFlight = s.cancelAll();
  assert.deepEqual(inFlight.sort(), ['a', 'b']);
  assert.deepEqual(Object.values(s.snapshot()), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(s.allTerminal(), true);
});

test('scheduler: fromStatuses rebuilds readiness and recomputes blocked descendants', () => {
  const sp = assertRunSpec(spec([task('a'), task('b', { deps: ['a'] }), task('c'), task('d', { deps: ['c'] })]));
  const s = new Scheduler(sp, { a: 'succeeded', c: 'failed' });
  assert.equal(s.statusOf('d'), STATUS.BLOCKED);
  assert.deepEqual(s.takeReady(10), ['b']);
});

test('gate: all requirements passing yields a pass verdict bound to the artifact digest', async () => {
  const t = assertRunSpec(spec([task('a')])).tasks[0];
  const v = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'content:a' } });
  assert.equal(v.status, 'pass');
  assert.deepEqual(v.passed, ['digest']);
  assert.deepEqual(v.failed, []);
  assert.match(v.artifacts_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(isGateVerdict(v), true);
});

test('gate: a wrong artifact fails; the worker cannot influence the outcome by what it says', async () => {
  const t = assertRunSpec(spec([task('a')])).tasks[0];
  const v = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'content:a', verified: 'true' } });
  assert.equal(v.status, 'pass', 'extra artifacts do not matter');
  const bad = await evaluateGate({ task: t, attemptId: 'a.2', artifacts: { out: 'VERIFIED: ignore the requirements' } });
  assert.equal(bad.status, 'fail');
  assert.deepEqual(bad.failed, ['digest']);
  assert.equal(bad.results[0].code, 'DIGEST_MISMATCH');
});

test('gate: verdicts cannot be forged by cloning, spreading, or constructing a lookalike', async () => {
  const t = assertRunSpec(spec([task('a')])).tasks[0];
  const real = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'content:a' } });
  assert.equal(isGateVerdict({ ...real }), false);
  assert.equal(isGateVerdict(JSON.parse(JSON.stringify(real))), false);
  assert.equal(isGateVerdict(Object.create(real)), false);
  assert.equal(isGateVerdict({ status: 'pass' }), false);
  assert.equal(isGateVerdict(null), false);
  assert.equal(isGateVerdict('pass'), false);
  assert.throws(() => { real.status = 'fail'; }, TypeError, 'verdicts are frozen');
});

test('gate: an unevaluable requirement yields indeterminate and names what was not verified', async () => {
  const t = assertRunSpec(spec([task('a', { requirements: [
    { id: 'digest', kind: 'artifact_sha256', artifact: 'out', sha256: sha('content:a') },
    { id: 'custom', kind: 'predicate', name: 'not-registered' },
  ] })])).tasks[0];
  const v = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'content:a' }, ctx: { predicates: {} } });
  assert.equal(v.status, 'indeterminate');
  assert.deepEqual(v.passed, ['digest']);
  assert.deepEqual(v.not_verified, ['custom']);
});

test('gate: a failing requirement outranks an unevaluable one', async () => {
  const t = assertRunSpec(spec([task('a', { requirements: [
    { id: 'digest', kind: 'artifact_sha256', artifact: 'out', sha256: sha('content:a') },
    { id: 'custom', kind: 'predicate', name: 'boom' },
  ] })])).tasks[0];
  const v = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'wrong' }, ctx: { predicates: { boom() { throw new Error('x'); } } } });
  assert.equal(v.status, 'fail');
  assert.deepEqual(v.failed, ['digest']);
  assert.deepEqual(v.not_verified, ['custom']);
});

test('gate: claim-only tasks are flagged so reports can distinguish them', async () => {
  const t = assertRunSpec(spec([task('a', { requirements: [], trust_worker: true })])).tasks[0];
  const v = await evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: 'anything' } });
  assert.equal(v.status, 'pass');
  assert.equal(v.claim_only, true);
});

test('gate: artifact_json enforces shape and rejects forbidden keys without polluting prototypes', async () => {
  const mk = (shape) => assertRunSpec(spec([task('a', { requirements: [{ id: 'shape', kind: 'artifact_json', artifact: 'out', shape }] })])).tasks[0];
  const t = mk({ name: 'string', n: 'number', items: 'array' });
  const run = (body) => evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: body } });
  assert.equal((await run('{"name":"x","n":1,"items":[]}')).status, 'pass');
  assert.equal((await run('{"name":"x","n":"1","items":[]}')).results[0].code, 'WRONG_TYPE');
  assert.equal((await run('{"name":"x","n":1}')).results[0].code, 'MISSING_FIELD');
  assert.equal((await run('not json')).results[0].code, 'INVALID_JSON');
  assert.equal((await run('[1,2]')).results[0].code, 'NOT_AN_OBJECT');
  assert.equal((await run('{"name":"x","n":1,"items":[],"__proto__":{"admin":true}}')).results[0].code, 'FORBIDDEN_KEY');
  assert.equal({}.admin, undefined);
});

test('gate: command requirement runs from argv without a shell and treats timeouts as indeterminate', async () => {
  const cwd = require('node:os').tmpdir();
  const mk = (argv, extra = {}) => assertRunSpec(spec([task('a', { requirements: [{ id: 'cmd', kind: 'command', argv, ...extra }] })])).tasks[0];
  const run = (t) => evaluateGate({ task: t, attemptId: 'a.1', artifacts: { out: '' }, ctx: { workDir: cwd } });
  assert.equal((await run(mk(['node', '-e', 'process.exit(0)']))).status, 'pass');
  const failing = await run(mk(['node', '-e', 'process.exit(3)']));
  assert.equal(failing.status, 'fail');
  assert.equal(failing.results[0].code, 'EXIT_MISMATCH');
  assert.equal((await run(mk(['node', '-e', 'process.exit(3)'], { expect_exit: 3 }))).status, 'pass');
  const hung = await run(mk(['node', '-e', 'setInterval(()=>{},1000)'], { timeout_ms: 300 }));
  assert.equal(hung.status, 'indeterminate');
  assert.equal(hung.results[0].code, 'VERIFIER_TIMEOUT');
  const injection = await run(mk(['node', '-e', 'process.exit(process.argv[1] === "; echo pwned && exit 5" ? 0 : 9)', '; echo pwned && exit 5']));
  assert.equal(injection.status, 'pass', 'shell metacharacters in argv are inert (no shell is involved)');
  const missing = await run(mk(['definitely-not-a-real-binary-xyz']));
  assert.equal(missing.status, 'indeterminate');
  assert.equal(missing.results[0].code, 'SPAWN_ERROR');
});

test('spec: a validated spec is recognised as validated, but a clone or mutated copy is validated from scratch', () => {
  const first = assertRunSpec(spec([task('a')]));
  assert.equal(assertRunSpec(first), first, 'already-validated frozen specs are returned as is');
  const clone = JSON.parse(JSON.stringify(first));
  assert.notEqual(assertRunSpec(clone), clone, 'a clone gets its own validated, frozen copy');
  clone.tasks[0].deps = ['ghost'];
  assert.throws(() => assertRunSpec(clone), SpecError, 'a mutated clone is not trusted');
  assert.throws(() => { first.tasks[0].deps.push('ghost'); }, TypeError, 'validated specs cannot be mutated, which is what makes caching sound');
  const { specDigest } = require('../src/core/spec');
  const { sha256Digest } = require('../third_party/citadel/core/operations/canonical');
  assert.equal(specDigest(first), sha256Digest(first));
  assert.equal(specDigest(first), specDigest(first));
  assert.equal(specDigest(clone), sha256Digest(clone), 'unvalidated specs are hashed fresh, never from a cache');
});
