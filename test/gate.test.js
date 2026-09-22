'use strict';

// The split gate without Docker: the membrane (objects, calls, errors, promises across two processes), the hostile-peer protections, and
// the strict reading of a verdict. The same code runs in the containers; test/gate-adversarial.test.js covers the real isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { localPair, passed, run } = require('./gate-helpers');
const { readVerdict, runHiddenGate } = require('../src/agent/gate');
const { loadTask, listSplit } = require('../src/agent/task');

const HEAD = "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\n";
const T = (body, requires = "const m = require('./sol');") => `${HEAD}${requires}\n${body}`;
const failedNames = (r) => (r.verdict ? r.verdict.top.filter((t) => !t.ok).map((t) => t.n) : null);

test('membrane: a plain function and its results behave like local ones, including negative zero, NaN, undefined and bigint', async () => {
  const r = await run(
    'module.exports = { id: (x) => x, add: (a, b) => a + b, none: () => undefined, big: (n) => BigInt(n) * 2n };',
    T(`
test('values', () => {
  assert.equal(m.add(2, 3), 5);
  assert.ok(Object.is(m.id(-0), -0));
  assert.ok(Number.isNaN(m.id(NaN)));
  assert.equal(m.id(Infinity), Infinity);
  assert.equal(m.none(), undefined);
  assert.equal(m.id(undefined), undefined);
  assert.equal(m.big(21), 42n);
  assert.equal(m.id('lone \\ud800 surrogate'), 'lone \\ud800 surrogate');
});`),
  );
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: results are real data for assert - arrays and objects compare with deepEqual, and a wrong answer fails the test', async () => {
  const solution = 'module.exports = { range: (n) => Array.from({ length: n }, (_, i) => i), pair: (a, b) => ({ a, b, nested: { list: [a, b] } }), wrong: () => [1, 2, 3] };';
  const ok = await run(solution, T(`
test('deep', () => {
  assert.deepEqual(m.range(5), [0, 1, 2, 3, 4]);
  assert.deepEqual(m.pair(1, 'x'), { a: 1, b: 'x', nested: { list: [1, 'x'] } });
  assert.deepStrictEqual(m.range(0), []);
  assert.equal(JSON.stringify(m.pair(1, 2)), '{"a":1,"b":2,"nested":{"list":[1,2]}}');
  assert.ok(Array.isArray(m.range(3)));
});`));
  assert.ok(passed(ok), JSON.stringify(ok.verdict) + ok.verdictStderr);
  const bad = await run(solution, T("test('wrong', () => { assert.deepEqual(m.wrong(), [1, 2, 4]); });"));
  assert.equal(passed(bad), false);
  assert.deepEqual(failedNames(bad), ['wrong']);
});

test('membrane: identity and mutation survive the boundary (returns a new array vs the same one; in-place edits are visible; frozen input stays frozen)', async () => {
  const r = await run(`
const keep = [1, 2, 3];
module.exports = {
  same: (a) => a,
  copy: (a) => [...a],
  push: (a) => { a.push('added'); },
  internal: () => keep,
  copyOfInternal: () => [...keep],
  freezeProbe: (a) => { try { a.push(1); return 'mutated'; } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } },
};`, T(`
test('identity and mutation', () => {
  const input = [1, 2];
  assert.equal(m.same(input), input);
  assert.notEqual(m.copy(input), input);
  assert.deepEqual(m.copy(input), input);
  m.push(input);
  assert.deepEqual(input, [1, 2, 'added']);
  assert.equal(m.internal(), m.internal(), 'the same internal array comes back as the same object');
  assert.notEqual(m.copyOfInternal(), m.copyOfInternal(), 'a fresh array each time stays fresh');
  const frozen = Object.freeze([1, 2]);
  assert.equal(m.freezeProbe(frozen), 'TypeError');
  const kept = m.internal();
  kept.push(4);
  assert.deepEqual(m.internal(), [1, 2, 3, 4], 'a write to a returned array reaches the solution state');
});`));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: errors keep their class, message and properties; an error made by the test comes back as the very same object', async () => {
  const r = await run(`
module.exports = {
  type: () => { throw new TypeError('bad type'); },
  range: () => { throw new RangeError('bad range'); },
  custom: () => { const e = new SyntaxError('at line'); e.line = 7; e.code = 'E_LINE'; throw e; },
  subclass: () => { class Mine extends TypeError {} throw new Mine('mine'); },
  plain: () => { throw 'a string'; },
  rethrow: (f) => { try { f(); } catch (e) { throw e; } },
  catchIt: (f) => { try { f(); return null; } catch (e) { return e; } },
};`, T(`
test('errors', () => {
  assert.throws(() => m.type(), TypeError);
  assert.throws(() => m.range(), (e) => e instanceof RangeError && e.message === 'bad range');
  assert.throws(() => m.custom(), (e) => e instanceof SyntaxError && e.line === 7 && e.code === 'E_LINE');
  assert.throws(() => m.subclass(), (e) => e instanceof TypeError && e.message === 'mine');
  assert.throws(() => m.plain(), (e) => e === 'a string');
  const boom = new Error('boom');
  assert.throws(() => m.rethrow(() => { throw boom; }), (e) => e === boom);
  assert.equal(m.catchIt(() => { throw boom; }), boom);
  assert.equal(m.catchIt(() => {}), null);
});`));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: callbacks run in the test process, with nested calls in both directions and stable function identity', async () => {
  const r = await run(`
class Emitter {
  constructor() { this.l = []; }
  on(f) { this.l.push(f); return () => { const i = this.l.indexOf(f); if (i >= 0) this.l.splice(i, 1); }; }
  emit(...a) { for (const f of [...this.l]) f(...a); return this.l.length; }
  get size() { return this.l.length; }
  static make() { return new Emitter(); }
}
module.exports = { Emitter, apply: (f, x) => f(x) + 1, twice: (f) => f(f(1)), each: (xs, f) => xs.map((x, i) => f(x, i)) };`, T(`
const { Emitter } = m;
test('callbacks', () => {
  assert.equal(m.apply((x) => x * 10, 4), 41);
  assert.equal(m.twice((x) => x + 1), 3);
  assert.deepEqual(m.each(['a', 'b'], (x, i) => x + i), ['a0', 'b1']);
  const e = new Emitter();
  const seen = [];
  const f = (x) => seen.push(x);
  const off = e.on(f);
  assert.equal(e.size, 1);
  assert.equal(e.emit(1), 1);
  off();
  assert.equal(e.size, 0);
  e.on(f); e.on(f);
  assert.equal(e.emit(2), 2);
  assert.deepEqual(seen, [1, 2, 2]);
  assert.ok(e instanceof Emitter);
  assert.ok(Emitter.make() instanceof Emitter);
  assert.equal(typeof Emitter, 'function');
});
test('a callback that throws propagates through the solution', () => {
  const e = new Emitter();
  e.on(() => { throw new RangeError('from the test'); });
  assert.throws(() => e.emit(), (x) => x instanceof RangeError && x.message === 'from the test');
});`));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: promises, async callbacks and timers across the boundary, and a rejection that nobody handles reaches the test process', async () => {
  const r = await run(`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  later: async (x) => { await sleep(10); return x * 2; },
  fail: async () => { await sleep(5); throw new TypeError('async boom'); },
  pool: async (items, fn, limit) => { const out = []; let i = 0; await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; },
  leak: () => { Promise.reject(new Error('nobody catches this')); return 'done'; },
  isPromise: () => Promise.resolve(1),
};`, T(`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('async', async () => {
  assert.equal(await m.later(4), 8);
  await assert.rejects(m.fail(), TypeError);
  assert.deepEqual(await m.pool([1, 2, 3, 4], async (x) => { await sleep(3); return x * x; }, 2), [1, 4, 9, 16]);
  assert.ok(m.isPromise() instanceof Promise);
});
test('unhandled rejection inside the solution is visible to listeners in the test process', async () => {
  const seen = [];
  const handler = (reason) => seen.push(reason);
  process.on('unhandledRejection', handler);
  try { assert.equal(m.leak(), 'done'); await sleep(150); } finally { process.off('unhandledRejection', handler); }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].message, 'nobody catches this');
});`));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: Date, RegExp, Map, Set and byte arrays cross by value; objects without a prototype and getters keep their behaviour', async () => {
  const r = await run(`
module.exports = {
  day: (d) => d.getUTCDay(),
  addDays: (d, n) => new Date(d.getTime() + n * 86400000),
  match: (re, s) => re.test(s),
  keys: (m) => [...m.keys()],
  mapOf: () => new Map([['a', 1]]),
  setOf: () => new Set([1, 2]),
  bytes: () => new Uint8Array([1, 2, 3]),
  nullProto: () => Object.assign(Object.create(null), { k: 'v' }),
  getter: () => ({ get x() { return 42; } }),
};`, T(`
test('by value', () => {
  assert.equal(m.day(new Date(Date.UTC(2024, 2, 4))), 1);
  assert.equal(m.addDays(new Date(Date.UTC(2024, 0, 1)), 31).toISOString(), '2024-02-01T00:00:00.000Z');
  assert.ok(m.match(/^a+$/i, 'AAA'));
  assert.deepEqual(m.keys(new Map([['x', 1], ['y', 2]])), ['x', 'y']);
  assert.ok(m.mapOf() instanceof Map && m.mapOf().get('a') === 1);
  assert.deepEqual([...m.setOf()], [1, 2]);
  assert.deepEqual([...m.bytes()], [1, 2, 3]);
  const n = m.nullProto();
  assert.equal(Object.getPrototypeOf(n), null);
  assert.equal(n.k, 'v');
  assert.equal(m.getter().x, 42);
  assert.throws(() => m.day(null), TypeError);
});`));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: an argument that is itself a Proxy is read lazily - the solution pays for exactly the elements it touches (the bounds task)', async () => {
  const r = await run(`
module.exports = { lowerBound: (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; } return lo; } };`, T(`
test('reads a handful of a million', () => {
  const data = Array.from({ length: 1_000_000 }, (_, i) => i * 2);
  let reads = 0;
  const proxy = new Proxy(data, { get(target, key, receiver) { if (typeof key === 'string' && /^\\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
  assert.equal(m.lowerBound(proxy, 777), 389);
  assert.ok(reads <= 25, 'read ' + reads);
  assert.equal(m.lowerBound(data, 777), 389, 'a plain array of that size is read lazily too');
});`, "const m = require('./sol');"));
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});

test('membrane: a solution that only returns wrong values fails; one that hangs is cut off by the harness, not passed', async () => {
  const wrong = await run('module.exports = { f: () => 1 };', T("test('f', () => { assert.equal(m.f(), 2); });"));
  assert.equal(passed(wrong), false);
  assert.equal(wrong.verdict.counts.fail, 1);
});

test('hostile peer: forged requests for the verdict side\'s built-ins are refused, the verdict stays intact, and nothing in it comes from the solution', async () => {
  // The scripted peer plays the part of a solution that speaks the protocol by hand and tries to reach Function / Object.prototype in the verdict process.
  const peer = `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Channel } = require('./channel');
const channel = new Channel({ inFd: 3, outFd: 4 });
const log = [];
channel.onMessage((raw) => { if (raw !== null) log.push(JSON.parse(raw)); });
const send = (o) => channel.send(JSON.stringify(o));
const answer = (i, v) => send({ op: 'ret', i, ok: true, v });
let sentProbes = false;
channel.onMessage((raw) => {
  if (raw === null) return;
  const m = JSON.parse(raw);
  if (m.op === 'load') {
    answer(m.i, { t: 'r', id: 1, k: 'o', s: { pr: 'O', e: [['run', 7, { t: 'r', id: 2, k: 'f', s: { pr: 'F', e: [] } }]] } });
  } else if (m.op === 'apply' && !sentProbes) {
    sentProbes = true;
    // 1. ask the verdict side for the constructor of the callback it just gave us (that would be Function)
    send({ op: 'get', i: 101, o: 1, k: 'constructor' });
    send({ op: 'get', i: 102, o: 1, k: '__proto__' });
    send({ op: 'apply', i: 103, f: 999, th: { t: 'u' }, a: [] });
    send({ op: 'set', i: 104, o: 1, k: '__proto__', v: { t: 'u' } });
    send({ op: 'def', i: 105, o: 1, k: 'polluted', d: { t: 'u' } });
    send({ op: 'load', i: 106, file: 'sol.js' });
    send({ op: 'bogus', i: 107 });
    fs.writeSync(4, '@@wrp this is not json\\n');
    fs.writeSync(4, '@@wrp {"op":"ret","i":424242,"ok":true,"v":"nope"}\\n');
    fs.writeSync(4, '@@wrp {"op":"settle","p":9,"ok":true,"v":1}\\n');
    setTimeout(() => { fs.writeSync(2, 'REPLIES ' + JSON.stringify(log.filter((x) => x.op === 'ret' && x.i >= 100).map((x) => [x.i, x.ok, x.v]))); answer(m.i, 'fine'); }, 500);
  }
});
channel.ref(); // after every onMessage: each one unrefs the port
`;
  const r = await localPair({
    solution: { 'sol.js': 'module.exports = {};' }, peerMain: peer, outputs: ['sol.js'], testFile: 'sol.test.js',
    tests: { 'sol.test.js': T("test('t', () => { const keep = {}; assert.equal(m.run(() => keep), 'fine'); assert.equal(Object.prototype.polluted, undefined); assert.equal(typeof Function.prototype.constructor, 'function'); });") },
  });
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr + r.solutionStderr);
  const replies = JSON.parse(/REPLIES (.*)/.exec(r.solutionStderr)[1]);
  const byId = Object.fromEntries(replies.map(([i, ok]) => [i, ok]));
  const valueOf = Object.fromEntries(replies.map(([i, , v]) => [i, v]));
  assert.equal(byId[101], false, 'constructor of a test function (Function) is not handed out');
  assert.equal(byId[102], false, 'the prototype (Function.prototype) is not handed out');
  assert.equal(byId[103], false, 'an unknown object id is an error');
  assert.deepEqual([byId[104], valueOf[104]], [true, false], '__proto__ is not writable from the other side (the answer is "false")');
  assert.equal(byId[105], false, 'a descriptor that is not an object is refused');
  assert.equal(byId[106], false, 'the verdict side loads nothing');
  assert.equal(byId[107], false, 'an unknown operation is an error');
});

test('a solution process that ends before the tests are done ends the gate as a failure, even when every remaining assertion is "throws"', async () => {
  const r = await run('module.exports = { f: () => { process.exit(0); } };', T("test('throws', () => { assert.throws(() => m.f()); });\ntest('also throws', () => { assert.throws(() => m.f()); });"));
  assert.equal(passed(r), false);
  assert.equal(r.verdict.aborted, 'SOLUTION_EXITED');
});

test('readVerdict: skipped, todo, cancelled and failed tests are never a pass, and a suite that ran other tests than the pinned ones is a mismatch', () => {
  const base = { version: 1, counts: { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, top: [{ n: 'a', ok: true }, { n: 'b', ok: true }] };
  assert.equal(readVerdict(base).ok, true);
  for (const patch of [{ skipped: 1 }, { todo: 1 }, { cancelled: 1 }, { fail: 1 }, { pass: 1 }, { tests: 0, pass: 0 }]) assert.equal(readVerdict({ ...base, counts: { ...base.counts, ...patch } }).ok, false, JSON.stringify(patch));
  assert.equal(readVerdict({ ...base, top: [{ n: 'a', ok: true }, { n: 'b', ok: false }] }).ok, false);
  assert.equal(readVerdict({ ...base, top: [] }).ok, false);
  assert.equal(readVerdict({ ...base, counts: { ...base.counts, tests: '2' } }).ok, false);
  assert.equal(readVerdict(null).ok, false);
  assert.equal(readVerdict({ ...base, version: 2 }).ok, false);
  assert.equal(readVerdict(base, { tests: 2, names: ['a', 'b'] }).ok, true);
  assert.equal(readVerdict(base, { tests: 3, names: ['a', 'b', 'c'] }).mismatch, true);
  assert.equal(readVerdict(base, { tests: 2, names: ['b', 'a'] }).mismatch, true);
  assert.equal(readVerdict({ ...base, counts: { ...base.counts, tests: 1, pass: 1 }, top: [{ n: 'a', ok: true }] }, { tests: 2, names: ['a', 'b'] }).mismatch, true, 'a run that quietly dropped a test is not a pass');
});

test('runHiddenGate: a forged "1 of 1 passed" verdict for a suite pinned at 7 tests is a failure, a verdict-less run is a failure, and an infrastructure error is an error, never a pass', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const task = loadTask(listSplit('toy').find((d) => d.endsWith('slugify')));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-gate-stub-'));
  fs.copyFileSync(path.join(task.referenceDir, 'slugify.js'), path.join(ws, 'slugify.js'));
  const file = 'slugify.hidden.test.js';
  const forged = { verdict: { version: 1, counts: { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, top: [{ n: 'one', ok: true }] }, verdictExit: 0, solutionExit: 0, solutionExited: false };
  const pinned = { [file]: { tests: 7, names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } };
  try {
    const r1 = await runHiddenGate({ task, workspace: ws, expected: pinned, runner: async () => forged });
    assert.equal(r1.status, 'fail');
    assert.equal(r1.code, 'GATE_SUITE_MISMATCH');
    const r2 = await runHiddenGate({ task, workspace: ws, expected: null, runner: async () => forged });
    assert.equal(r2.status, 'pass', 'with no pins the verdict itself is all there is (the checked-in manifest supplies the pins in real runs)');
    const r3 = await runHiddenGate({ task, workspace: ws, runner: async () => ({ verdict: null, problem: 'no verdict line', verdictExit: 1 }) });
    assert.equal(r3.status, 'fail');
    assert.equal(r3.code, 'GATE_NO_VERDICT');
    const r4 = await runHiddenGate({ task, workspace: ws, runner: async () => ({ spawnError: 'docker infrastructure failure' }) });
    assert.equal(r4.status, 'error');
    const r5 = await runHiddenGate({ task, workspace: ws, runner: async () => ({ ...forged, verdictExit: 3, verdict: { version: 1, aborted: 'GATE_PROTOCOL_ERROR', detail: 'x' } }) });
    assert.equal(r5.status, 'fail');
    assert.equal(r5.code, 'GATE_ABORTED');
    const r5b = await runHiddenGate({ task, workspace: ws, runner: async () => ({ ...forged, verdictExit: 3, solutionExit: 137, verdict: { version: 1, aborted: 'SOLUTION_EXITED', detail: 'x' } }) });
    assert.equal(r5b.code, 'SOLUTION_EXITED', 'the verdict side noticing the loss first is reported under the same code');
    const r6 = await runHiddenGate({ task, workspace: ws, runner: async () => ({ ...forged, solutionExited: true, solutionExit: 0 }) });
    assert.equal(r6.code, 'SOLUTION_EXITED');
    const r7 = await runHiddenGate({ task, workspace: ws, runner: async () => ({ ...forged, timedOut: true }) });
    assert.equal(r7.code, 'TIMEOUT');
    fs.rmSync(path.join(ws, 'slugify.js'));
    const r8 = await runHiddenGate({ task, workspace: ws, runner: async () => forged });
    assert.equal(r8.code, 'MISSING_OUTPUT');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('membrane: several declared outputs, and a pristine helper that a test imports and that imports them (an integration test)', async () => {
  const r = await localPair({
    outputs: ['a.js', 'b.js'], testFile: 'sol.test.js',
    solution: { 'a.js': 'module.exports = { one: () => 1 };', 'b.js': 'module.exports = { two: () => 2 };' },
    tests: {
      'index.js': "const { one } = require('./a');\nconst { two } = require('./b');\nmodule.exports = { sum: () => one() + two() };\n",
      'sol.test.js': T("test('integration', () => { assert.equal(require('./index').sum(), 3); assert.equal(require('./a').one(), 1); assert.equal(require('./b').two(), 2); assert.notEqual(require('./a'), require('./b')); });", ''),
    },
  });
  assert.ok(passed(r), JSON.stringify(r.verdict) + r.verdictStderr);
});
