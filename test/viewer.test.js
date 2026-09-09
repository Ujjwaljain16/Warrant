'use strict';

// The offline run-log viewer (viewer/, scripts/build-viewer.js, scripts/gen-viewer-samples.js).
// Its logic runs in Node here exactly as it runs in the page, and every answer is compared with the engine's own
// (verifyEntries / readRunLogFile / auditLog / replayLog) on logs the real engine wrote.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const upstream = require('../third_party/citadel/core/operations/canonical');
const { EVENT_TYPES, LogCorruptionError, readRunLogFile, verifyEntries } = require('../src/log/runlog');
const engineStates = require('../src/core/states');
const { auditLog, replayLog } = require('../src/engine/replay');
const { d, simulate } = require('./sim-helpers');
const { generate, rehash } = require('../scripts/gen-viewer-samples');
const { build, MODULES } = require('../scripts/build-viewer');

const SRC = path.join(__dirname, '..', 'viewer', 'src');
const V = (name) => require(path.join(SRC, name));
const canonical = V('canonical');
const { analyze } = V('analysis');
const { parseLog, classifyText, LIMITS } = V('parse');
const { verifyChain } = V('chain');
const text = V('text');
const viewerStates = V('states');

const toText = (entries) => entries.map((e) => `${JSON.stringify(e)}\n`).join('');
const clone = (x) => JSON.parse(JSON.stringify(x));
const LOG_ONLY_CODES = new Set(['I1_UNVERIFIED_SUCCESS', 'I4_START_AFTER_TERMINAL', 'I4_TERMINAL_CHANGED', 'I6_DOUBLE_INGEST', 'I7_START_AFTER_CANCEL', 'ATTEMPT_NUMBERING', 'I8_CHAIN']);

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-viewer-'));
  const file = path.join(dir, 'run.log');
  fs.writeFileSync(file, content);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// What the engine says about a file: its entries and torn flag, or the corruption it throws.
function engineRead(content) {
  const { file, cleanup } = tmpFile(content);
  try {
    const r = readRunLogFile(file);
    return { ok: true, count: r.entries.length, torn: r.torn, head: r.head };
  } catch (error) {
    if (!(error instanceof LogCorruptionError)) throw error;
    return { ok: false, code: error.code, message: error.message.replace(file, '<file>') };
  } finally { cleanup(); }
}

// ----------------------------------------------------------------------------- scenarios from the real engine

let cache = null;
async function scenarios() {
  if (cache) return cache;
  const diamond = [d('a'), d('b', ['a']), d('c', ['a']), d('e', ['b', 'c'])];
  const lie = { kind: 'false_claim' };
  const out = {};
  const run = async (name, draft, script, options) => {
    const r = await simulate(draft, script, options);
    assert.deepEqual(r.violations, [], `${name}: the engine's own audit must be clean`);
    out[name] = { name, spec: r.workload.spec, entries: r.entries.map((e) => clone(e)), report: r.report };
  };
  await run('honest', diamond, {});
  await run('false-claim', [d('a'), d('b', ['a'])], { 'a.1': lie });
  await run('lies-exhaust', [d('a'), d('b', ['a'])], { 'a.1': lie, 'a.2': lie, 'a.3': lie });
  await run('crash-applied', [d('a', [], 'external-nonrepeatable')], { 'a.1': { kind: 'crash_after' } });
  await run('crash-not-applied', [d('a', [], 'external-nonrepeatable')], { 'a.1': { kind: 'crash_before' } });
  await run('crash-no-reconcile', [d('a', [], 'external-nonrepeatable'), d('b', ['a'])], { 'a.1': { kind: 'crash_after' } }, { reconcile: false });
  await run('crash-retry', [d('a')], { 'a.1': { kind: 'crash_before' } });
  await run('duplicate', [d('a'), d('b', ['a'])], { 'a.1': { duplicate: true } });
  await run('timeout', [d('a')], { 'a.1': { kind: 'delay' } });
  await run('cancel', [d('a'), d('b', ['a']), d('c', ['b']), d('x'), d('y', ['x'])], {}, { cancelAt: 150 });
  cache = out;
  return out;
}

// ----------------------------------------------------------------------------- canonical JSON and hashing

test('canonical JSON and SHA-256 match the vendored upstream implementation', async () => {
  const values = [
    { b: 1, a: [3, { z: null, y: false }], c: 'x' },
    { 'é': 1, 'a': 2, '\u{1F600}': 3, 'Z': 4, '10': 5, '9': 6 },
    { n: -0, big: 12345678901234567890, small: 1e-7, neg: -1.5 },
    [],
    {},
    'plain string with "quotes" and \\ backslash and   separators',
    { deep: { deeper: { deepest: [1, [2, [3]]] } } },
  ];
  for (const value of values) {
    assert.equal(canonical.canonicalSerialize(value), upstream.canonicalSerialize(value));
    assert.equal(await canonical.sha256Digest(value), upstream.sha256Digest(value));
  }
  assert.throws(() => canonical.canonicalSerialize({ a: Infinity }), /non-finite/);
  assert.throws(() => canonical.canonicalSerialize({ a: undefined }), /undefined/);
});

test('the WebCrypto path and the built-in fallback agree with node:crypto', async () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4097]) {
    const bytes = crypto.randomBytes(0).length === 0 ? Buffer.alloc(n, 31 + (n % 200)) : null;
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(canonical.sha256HexFallback(new Uint8Array(bytes)), expected, `fallback, ${n} bytes`);
    assert.equal(await canonical.sha256HexOfText(bytes.toString('latin1')), crypto.createHash('sha256').update(bytes.toString('latin1'), 'utf8').digest('hex'));
  }
  assert.equal(canonical.hashBackend(), 'webcrypto');
  // Without crypto.subtle the page must still verify, and say so.
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try {
    const sample = { a: 1, b: [2, 3] };
    assert.equal(await canonical.sha256Digest(sample), upstream.sha256Digest(sample));
    assert.equal(canonical.hashBackend(), 'javascript fallback');
  } finally { Object.defineProperty(globalThis, 'crypto', saved); }
});

// ----------------------------------------------------------------------------- chain and parse, against the engine

test('chain verification of every engine-written scenario agrees with verifyEntries', async () => {
  for (const s of Object.values(await scenarios())) {
    const a = await analyze(toText(s.entries), { specValue: s.spec });
    const engine = verifyEntries(s.entries);
    assert.equal(a.chain.status, 'valid', s.name);
    assert.equal(a.chain.verified, engine.count);
    assert.equal(a.chain.head, engine.head);
    assert.equal(a.specMatch, true, `${s.name}: the spec digest recorded in run_started must match`);
  }
});

test('every kind of tampering is reported with the same reason the engine gives', async () => {
  const { honest } = await scenarios();
  const mutate = {
    'edited data': (e) => { e[3].data.status = 'pass'; e[3].data.tampered = 1; },
    'deleted entry': (e) => { e.splice(4, 1); },
    'reordered entries': (e) => { [e[2], e[3]] = [e[3], e[2]]; },
    'edited prev': (e) => { e[5].prev = e[1].hash; },
    'extra field': (e) => { e[1].admin = true; },
    'wrong version': (e) => { e[2].v = 2; },
    'bad hash format': (e) => { e[6].hash = 'sha256:xyz'; },
    'edited task id': (e) => { e[2].task = 'zzz'; },
    'forbidden key': (e) => { e[2].data = JSON.parse('{"__proto__":{"x":1}}'); },
    'oversized data': (e) => { e[2].data = { big: 'x'.repeat(9000) }; },
    'unknown event type': (e) => { e[2].type = 'run_pwned'; },
    'negative time': (e) => { e[2].t = -5; },
    'first entry with a prev': (e) => { e[0].prev = e[1].hash; },
  };
  for (const [name, fn] of Object.entries(mutate)) {
    const entries = clone(honest.entries);
    fn(entries);
    let engineMessage = null;
    try { verifyEntries(entries); } catch (error) { engineMessage = error.message; }
    assert.ok(engineMessage, `${name}: the engine must reject this`);
    const a = await analyze(toText(entries), { specValue: honest.spec });
    assert.equal(a.chain.status, 'broken', name);
    assert.equal(a.chain.broken.message, engineMessage, name);
    assert.deepEqual(a.violations, auditLog(honest.spec, entries), `${name}: audit result`);
    assert.deepEqual(a.violations.map((v) => v.code), ['I8_CHAIN']);
    assert.equal(a.chain.verified, a.chain.broken.index - 1);
  }
});

test('the broken entry reports stored and recomputed hashes when only the content changed', async () => {
  const { honest } = await scenarios();
  const entries = clone(honest.entries);
  entries[3].data.passed = ['digest', 'forged'];
  const a = await analyze(toText(entries));
  assert.equal(a.chain.broken.index, 4);
  assert.equal(a.chain.broken.storedHash, honest.entries[3].hash);
  assert.notEqual(a.chain.broken.expectedHash, a.chain.broken.storedHash);
});

test('torn final line and invalid lines follow the engine rule', async () => {
  const { 'false-claim': s } = await scenarios();
  const full = toText(s.entries);
  const lines = full.split('\n').filter(Boolean);
  const cases = {
    'clean': full,
    'half a line, no newline': `${lines.slice(0, -1).join('\n')}\n${lines[lines.length - 1].slice(0, 40)}`,
    'complete last line without newline': full.slice(0, -1),
    'only a torn line': '{"v":1,"se',
    'empty file': '',
  };
  for (const [name, content] of Object.entries(cases)) {
    const engine = engineRead(content);
    const a = await analyze(content);
    assert.ok(engine.ok, name);
    assert.equal(a.chain.status, engine.count === 0 ? 'empty' : 'valid', name);
    assert.equal(a.chain.total, engine.count, name);
    assert.equal(Boolean(a.chain.torn), engine.torn, name);
  }
  // A bad line that ends in a newline is not a torn write: the engine treats it as corruption, and so does the viewer.
  const garbage = `${lines.join('\n')}\n{"v":1,"seq"\n`;
  assert.equal(engineRead(garbage).code, 'INVALID_JSON');
  assert.equal((await analyze(garbage)).chain.status, 'broken');
  const middle = lines.slice();
  middle[5] = '{not json';
  const content = `${middle.join('\n')}\n`;
  const engine = engineRead(content);
  const a = await analyze(content);
  assert.equal(engine.code, 'INVALID_JSON');
  assert.equal(a.chain.status, 'broken');
  assert.equal(a.chain.broken.kind, 'invalid_json');
  assert.ok(engine.message.endsWith(a.chain.broken.message), `${engine.message} vs ${a.chain.broken.message}`);
  assert.equal(a.chain.verified, 5, 'the five entries before the bad line verify');
  assert.equal(a.parsed.entries.length, lines.length - 1, 'later entries are still readable, but unverified');
});

test('randomly damaged logs never crash the viewer and are judged like the engine judges them', async () => {
  const { honest, 'crash-applied': crash } = await scenarios();
  let seed = 123456789;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const junk = ['{"__proto__":{"x":1}}', '[]', '7', 'null', '"s"', `{"v":1,"seq":1,"t":0,"type":"run_started","data":{"a":"${'z'.repeat(20000)}"},"prev":null,"hash":"sha256:${'0'.repeat(64)}"}`, '‮‮', '{"seq":'];
  const glyphs = ['"', '{', '}', '‮', '\u0000', '9', ' ', '\\', ','];
  let broken = 0;
  let valid = 0;
  for (let i = 0; i < 160; i++) {
    const base = (i % 2 ? crash : honest);
    const lines = toText(base.entries).split('\n').filter(Boolean);
    const mode = rnd(8);
    const at = rnd(lines.length);
    let content;
    if (mode === 0) { lines.splice(at, 1); content = `${lines.join('\n')}\n`; }
    else if (mode === 1) { lines.splice(at, 0, lines[at]); content = `${lines.join('\n')}\n`; }
    else if (mode === 2) { const p = rnd(lines[at].length); lines[at] = lines[at].slice(0, p) + glyphs[rnd(glyphs.length)] + lines[at].slice(p + 1); content = `${lines.join('\n')}\n`; }
    else if (mode === 3) { content = `${lines.join('\n')}\n`.slice(0, rnd(lines.join('\n').length)); }
    else if (mode === 4) { lines.splice(at, 0, junk[rnd(junk.length)]); content = `${lines.join('\n')}\n`; }
    else if (mode === 5) { const o = rnd(lines.length); [lines[at], lines[o]] = [lines[o], lines[at]]; content = `${lines.join('\n')}\n`; }
    else if (mode === 6) { content = `${lines.join('\n')}\n${junk[rnd(junk.length)]}`; }
    else { lines[at] = lines[at].replace(/"[a-z_]+":/, '"data":'); content = `${lines.join('\r\n')}\r\n`; }

    const a = await analyze(content, { specValue: base.spec });
    assert.ok(['valid', 'broken', 'empty'].includes(a.chain.status));
    assert.equal(typeof a.summary.headline, 'string');
    const engine = engineRead(content);
    if (engine.ok) {
      valid++;
      assert.notEqual(a.chain.status, 'broken', `iteration ${i} mode ${mode}: engine accepts, viewer rejects: ${a.chain.broken && a.chain.broken.message}`);
      assert.equal(a.chain.total, engine.count);
      assert.equal(Boolean(a.chain.torn), engine.torn);
    } else {
      broken++;
      assert.equal(a.chain.status, 'broken', `iteration ${i} mode ${mode}: engine rejects (${engine.message}), viewer accepts`);
      if (engine.code === 'INVALID_ENTRY' && a.chain.broken.kind === 'entry') assert.equal(engine.message, a.chain.broken.message);
      if (engine.code === 'INVALID_JSON' && a.chain.broken.kind === 'invalid_json') assert.ok(engine.message.endsWith(a.chain.broken.message));
    }
  }
  assert.ok(broken > 20 && valid > 5, `fuzz should exercise both outcomes (valid ${valid}, broken ${broken})`);
});

// ----------------------------------------------------------------------------- audit parity

const permissive = (entries) => ({
  max_concurrency: 1e9,
  tasks: [...new Set(entries.filter((e) => e.task).map((e) => e.task))].map((id) => ({ id, deps: [], effect: 'pure', max_attempts: 1e9 })),
});

test('audit: with the spec the viewer gives auditLog\'s exact answers; without it, the log-only subset', async () => {
  const sc = await scenarios();
  const lying = sc['lies-exhaust'];
  const find = (entries, pred) => entries.findIndex(pred);
  const cases = [];
  const add = (name, base, fn, specFn) => {
    const entries = clone(base.entries);
    const spec = clone(base.spec);
    fn(entries, spec);
    cases.push({ name, spec: specFn ? specFn(spec) : spec, entries: rehash(entries) });
  };
  for (const s of Object.values(sc)) cases.push({ name: `clean ${s.name}`, spec: s.spec, entries: s.entries });
  add('forged success', lying, (e) => {
    const i = find(e, (x) => x.type === 'task_settled' && x.task === 'a');
    const claimed = e.findLast((x) => x.type === 'attempt_result' && x.task === 'a');
    e[i] = { ...e[i], attempt: 'a.3', data: { status: 'succeeded', code: 'VERIFIED', digest: claimed.data.digest } };
  });
  add('success without any verdict', sc.honest, (e) => { for (let i = e.length - 1; i >= 0; i--) if (e[i].type === 'gate_verdict' && e[i].task === 'a') e.splice(i, 1); });
  add('success bound to a different digest', sc.honest, (e) => { const i = find(e, (x) => x.type === 'task_settled' && x.task === 'a'); e[i].data.digest = `sha256:${'a'.repeat(64)}`; });
  add('result ingested twice', sc.honest, (e) => { const i = find(e, (x) => x.type === 'attempt_result' && x.task === 'b'); e.splice(i + 1, 0, clone(e[i])); });
  add('attempt after settlement', sc.honest, (e) => {
    const i = find(e, (x) => x.type === 'task_settled' && x.task === 'a');
    e.splice(i + 1, 0, { v: 1, t: e[i].t, type: 'attempt_started', task: 'a', attempt: 'a.2', data: { no: 2 } });
  });
  add('task settled twice', sc.honest, (e) => { const i = find(e, (x) => x.type === 'task_settled' && x.task === 'a'); e.splice(i + 1, 0, clone(e[i])); });
  add('attempt after cancel', sc.cancel, (e) => {
    const i = find(e, (x) => x.type === 'cancel_requested');
    e.splice(i + 1, 0, { v: 1, t: e[i].t, type: 'attempt_started', task: 'x', attempt: 'x.9', data: { no: 9 } });
  });
  add('attempt numbering gap', sc.honest, (e) => { const i = find(e, (x) => x.type === 'attempt_started' && x.task === 'c'); e[i].data.no = 5; });
  add('dependency never succeeded', sc.honest, (e) => { const i = find(e, (x) => x.type === 'task_settled' && x.task === 'a'); e.splice(i, 1); });
  add('unknown task', sc.honest, (e) => { const i = find(e, (x) => x.type === 'attempt_started' && x.task === 'c'); e[i].task = 'ghost'; });
  add('attempt budget exceeded', sc['false-claim'], () => {}, (spec) => { spec.tasks[0].max_attempts = 1; return spec; });
  add('concurrency cap exceeded', sc.honest, () => {}, (spec) => { spec.max_concurrency = 1; return spec; });
  add('non-repeatable restart without a reconcile', sc['crash-not-applied'], (e) => { const i = find(e, (x) => x.type === 'reconcile'); e.splice(i, 1); });
  add('non-repeatable restarted after an applied reconcile', sc['crash-not-applied'], (e) => { const i = find(e, (x) => x.type === 'reconcile'); e[i].data.outcome = 'applied'; });

  const seen = new Set();
  for (const c of cases) {
    const expected = auditLog(c.spec, c.entries);
    const a = await analyze(toText(c.entries), { specValue: c.spec });
    assert.equal(a.chain.status, 'valid', c.name);
    assert.deepEqual(a.violations, expected, `${c.name}: with spec`);
    expected.forEach((v) => seen.add(v.code));

    const logOnly = await analyze(toText(c.entries));
    const reference = auditLog(permissive(c.entries), c.entries);
    assert.deepEqual(logOnly.violations, reference, `${c.name}: log only`);
    assert.ok(logOnly.violations.every((v) => LOG_ONLY_CODES.has(v.code)), `${c.name}: log-only mode must not claim spec-dependent codes`);
    for (const row of logOnly.invariants.filter((r) => r.needsSpec)) assert.equal(row.state, 'needs-spec', `${c.name}: ${row.id} must be reported as unchecked, not as passing`);
  }
  for (const code of ['I1_UNVERIFIED_SUCCESS', 'I2_DEP_NOT_SUCCEEDED', 'I3_ATTEMPT_BUDGET', 'I3_CONCURRENCY', 'I4_START_AFTER_TERMINAL', 'I4_TERMINAL_CHANGED', 'I5_NONREPEATABLE_RESTART', 'I6_DOUBLE_INGEST', 'I7_START_AFTER_CANCEL', 'ATTEMPT_NUMBERING', 'UNKNOWN_TASK']) {
    assert.ok(seen.has(code), `the mutation set must exercise ${code}`);
  }
});

test('a broken chain is judged on its verified prefix only', async () => {
  const { 'false-claim': s } = await scenarios();
  const entries = clone(s.entries);
  entries[8].data.code = 'EDITED';
  const a = await analyze(toText(entries), { specValue: s.spec });
  assert.equal(a.chain.verified, 8);
  assert.equal(a.invariants.find((r) => r.id === 'I8').state, 'violated');
  assert.equal(a.invariants.find((r) => r.id === 'I1').state, 'prefix-ok');
  assert.equal(a.summary.tone, 'bad');
});

// ----------------------------------------------------------------------------- model

test('derived per-task status, attempts and counters agree with replayLog', async () => {
  for (const s of Object.values(await scenarios())) {
    const a = await analyze(toText(s.entries), { specValue: s.spec });
    const replay = replayLog(s.entries);
    for (const [id, t] of replay.tasks) {
      const m = a.model.tasks.get(id);
      assert.equal(m.attempts, t.attempts, `${s.name}/${id} attempts`);
      if (t.status !== engineStates.STATUS.PENDING) { assert.equal(m.status, t.status, `${s.name}/${id} status`); assert.equal(m.code, t.code); }
      assert.equal(m.digest, t.digest);
    }
    assert.equal(a.model.global.duplicates, replay.duplicates, s.name);
    assert.equal(Boolean(a.model.global.cancel), replay.cancelled, s.name);
    assert.equal(a.model.global.finished && a.model.global.finished.status, replay.runStatus, s.name);
    for (const task of a.model.tasks.values()) for (const tr of task.transitions) assert.ok(tr.legal, `${s.name}/${task.id}: ${tr.from} -> ${tr.to} must be allowed by the state machine`);
    for (const id of Object.keys(s.report.tasks)) {
      const m = a.model.tasks.get(id);
      const reported = s.report.tasks[id].status;
      assert.equal(m.finalStatus === 'pending' && reported === 'blocked' ? 'blocked' : m.finalStatus, reported, `${s.name}/${id} vs the engine report`);
    }
  }
});

test('timelines show what happened: rejected claims, crashes, reconcile, duplicates, cancel', async () => {
  const sc = await scenarios();
  const kinds = (a, id) => a.model.tasks.get(id).attemptList.map((x) => x.kind);

  let a = await analyze(toText(sc['false-claim'].entries), { specValue: sc['false-claim'].spec });
  assert.deepEqual(kinds(a, 'a'), ['rejected', 'accepted']);
  assert.equal(a.counts.rejected, 1);
  assert.match(a.summary.headline, /caught 1 false claim/);
  assert.deepEqual(a.model.tasks.get('a').transitions.map((t) => t.to), ['running', 'verifying', 'pending', 'running', 'verifying', 'succeeded']);

  a = await analyze(toText(sc['crash-retry'].entries), { specValue: sc['crash-retry'].spec });
  assert.deepEqual(kinds(a, 'a'), ['crashed', 'accepted']);

  a = await analyze(toText(sc['crash-applied'].entries), { specValue: sc['crash-applied'].spec });
  const att = a.model.tasks.get('a').attemptList;
  assert.equal(att.length, 1);
  assert.equal(att[0].reconcile.outcome, 'applied');
  assert.equal(att[0].kind, 'accepted');
  assert.deepEqual(a.model.tasks.get('a').transitions.map((t) => t.to), ['running', 'verifying', 'succeeded'], 'reconcile-applied goes through the gate');

  a = await analyze(toText(sc['crash-not-applied'].entries), { specValue: sc['crash-not-applied'].spec });
  assert.deepEqual(kinds(a, 'a'), ['ambiguous', 'accepted']);
  assert.equal(a.model.tasks.get('a').attemptList[0].reconcile.outcome, 'not_applied');

  a = await analyze(toText(sc['crash-no-reconcile'].entries), { specValue: sc['crash-no-reconcile'].spec });
  assert.equal(a.model.tasks.get('a').finalStatus, 'unknown');
  assert.equal(a.model.tasks.get('b').finalStatus, 'pending');

  a = await analyze(toText(sc.duplicate.entries), { specValue: sc.duplicate.spec });
  assert.ok(a.counts.duplicates >= 1);
  assert.ok(a.model.tasks.get('a').attemptList[0].duplicates.length >= 1);

  a = await analyze(toText(sc.timeout.entries), { specValue: sc.timeout.spec });
  assert.ok(a.model.tasks.get('a').attemptList.some((x) => x.kind === 'timeout'));

  a = await analyze(toText(sc.cancel.entries), { specValue: sc.cancel.spec });
  assert.ok(a.model.global.cancel);
  assert.ok([...a.model.tasks.values()].some((t) => t.finalStatus === 'cancelled'));
  assert.equal(a.model.tMeaningful, true);

  a = await analyze(toText(sc['lies-exhaust'].entries), { specValue: sc['lies-exhaust'].spec });
  assert.equal(a.model.tasks.get('a').finalStatus, 'failed');
  assert.equal(a.counts.rejected, 3);
});

test('the model survives nonsense without throwing', async () => {
  const { buildModel, tally } = V('model');
  const garbage = [null, 7, 'x', [], {}, { type: 5, task: {}, data: 'x' }, { type: 'task_settled', task: '__proto__', data: { status: 'succeeded' } },
    { type: 'attempt_result', task: 'constructor', attempt: 9, data: null }, { type: 'gate_verdict', task: 'a', data: { passed: 'no', failed: [1, 2], status: {} } },
    { type: 'attempt_started', task: 'a', data: { no: 'one' } }, { type: 'task_settled', task: 'a', data: { status: 'exploded' } }];
  const model = buildModel(garbage, { spec: { tasks: [{ id: 'a', deps: [] }, { id: 5 }, null] } });
  assert.ok(model.tasks.size >= 2);
  assert.ok(tally(model).attempts >= 0);
  assert.ok([...model.tasks.values()].every((t) => typeof t.finalStatus === 'string'));
});

// ----------------------------------------------------------------------------- display safety, limits, loading

test('hostile strings are made visible and bounded for display', () => {
  const rtl = `invoice${String.fromCharCode(0x202E)}fdp.exe`;
  assert.equal(text.revealHidden(rtl), 'invoice<U+202E>fdp.exe');
  assert.equal(text.revealHidden(`a${String.fromCharCode(0x200B)}b${String.fromCharCode(0)}c`), 'a<U+200B>b<U+0000>c');
  assert.equal(text.revealHidden(`x${String.fromCharCode(0xD800)}y`), `x${String.fromCharCode(0xFFFD)}y`);
  const long = 'A'.repeat(5_000_000);
  const clipped = text.clip(long, 100);
  assert.ok(clipped.length < 140 && clipped.includes('(+4999900 chars)'));
  assert.equal(text.show({ a: 1 }), '{"a":1}');
  assert.equal(text.show(undefined), '');
  assert.ok(!text.clip('<script>alert(1)</script>').includes('\u0000'));
  const pair = `${'a'.repeat(9)}\u{1F600}`;
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text.clip(pair, 10)), 'a cut never leaves half a surrogate pair');
});

test('limits, BOM, empty input and file classification', async () => {
  const { honest } = await scenarios();
  const full = toText(honest.entries);
  const small = parseLog(full, { ...LIMITS, maxEntries: 5 });
  assert.equal(small.entries.length, 5);
  assert.equal(small.truncated, true);
  const longLine = parseLog(`${'x'.repeat(50)}\n${full}`, { ...LIMITS, maxLineChars: 40 });
  assert.equal(longLine.problems[0].kind, 'line_too_long');
  const bom = await analyze(`﻿${full}`);
  assert.equal(bom.chain.status, 'valid');
  assert.equal(bom.parsed.bom, true);
  assert.equal((await analyze('')).chain.status, 'empty');
  assert.equal(LIMITS.maxBytes, 20 * 1024 * 1024);
  assert.equal(classifyText(full).kind, 'log');
  assert.equal(classifyText(JSON.stringify(honest.spec, null, 2)).kind, 'spec');
  assert.equal(classifyText('').kind, 'empty');
  assert.equal(classifyText('{"hello":1}').kind, 'unknown');
  assert.equal(classifyText(JSON.stringify(honest.entries[0])).kind, 'log');
});

test('a malformed spec is rejected with a reason and does not disable the log-only checks', async () => {
  const { honest } = await scenarios();
  for (const bad of [[], { tasks: [] }, { tasks: [{ id: 'a' }], max_concurrency: 1 }, { max_concurrency: 0, tasks: [{ id: 'a', deps: [], max_attempts: 1 }] }, { max_concurrency: 1, tasks: [{ id: 'a', deps: [], max_attempts: 1 }, { id: 'a', deps: [], max_attempts: 1 }] }]) {
    const a = await analyze(toText(honest.entries), { specValue: bad });
    assert.ok(a.specError, JSON.stringify(bad));
    assert.equal(a.spec, null);
    assert.equal(a.chain.status, 'valid');
  }
  const other = clone(honest.spec);
  other.run_id = 'a-different-run';
  assert.equal((await analyze(toText(honest.entries), { specValue: other })).specMatch, false);
});

// ----------------------------------------------------------------------------- mirrors of the engine's constants

test('the viewer\'s copies of the engine constants have not drifted', () => {
  assert.deepEqual(viewerStates.EVENT_TYPES, EVENT_TYPES);
  assert.deepEqual(viewerStates.STATUS, engineStates.STATUS);
  assert.deepEqual(JSON.parse(JSON.stringify(viewerStates.TRANSITIONS)), JSON.parse(JSON.stringify(engineStates.TRANSITIONS)));
  assert.deepEqual([...viewerStates.TERMINAL], [...engineStates.TERMINAL]);
});

// ----------------------------------------------------------------------------- samples

test('stored samples are exactly what the generator produces, and behave as advertised', async () => {
  const files = await generate();
  const dir = path.join(__dirname, '..', 'viewer', 'samples');
  for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), content, `${name} is stale: run node scripts/gen-viewer-samples.js`);
  const spec = JSON.parse(files['nightly-etl.spec.json']);

  const honest = await analyze(files['honest.jsonl'], { specValue: spec });
  assert.equal(honest.chain.status, 'valid');
  assert.deepEqual(honest.violations, []);
  assert.equal(honest.counts.byStatus.get('succeeded'), 6);
  assert.ok(honest.counts.reconciles >= 1 && honest.counts.duplicates >= 1 && honest.counts.crashed >= 1);
  assert.equal(honest.specMatch, true);

  const lying = await analyze(files['lying-worker.jsonl'], { specValue: spec });
  assert.equal(lying.chain.status, 'valid');
  assert.deepEqual(lying.violations, []);
  assert.equal(lying.counts.rejected, 4);
  assert.equal(lying.model.tasks.get('enrich').finalStatus, 'failed');
  assert.equal(lying.model.tasks.get('publish').finalStatus, 'pending');

  const tampered = await analyze(files['tampered.jsonl'], { specValue: spec });
  assert.equal(tampered.chain.status, 'broken');
  assert.match(tampered.chain.broken.message, /^entry 8: hash does not match entry content$/);

  const forged = await analyze(files['forged-success.jsonl'], { specValue: spec });
  assert.equal(forged.chain.status, 'valid', 'a forger who recomputes the hashes passes the chain check');
  assert.deepEqual(forged.violations.map((v) => v.code), ['I1_UNVERIFIED_SUCCESS']);
  assert.equal(forged.summary.tone, 'bad');
});

// ----------------------------------------------------------------------------- the built file

const html = build();

test('the build is deterministic and the stored file is current', () => {
  assert.equal(build(), html);
  assert.equal(Buffer.compare(Buffer.from(build()), Buffer.from(html)), 0);
  const stored = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'run-viewer.html'), 'utf8');
  assert.equal(stored, html, 'viewer/run-viewer.html is stale: run node scripts/build-viewer.js');
});

function parts(source) {
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const styles = [...source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
  return { scripts, styles, markup };
}

test('the built page references no external resource', () => {
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']?\/\//i, 'no protocol-relative references');
  const { scripts, styles, markup } = parts(html);
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  assert.doesNotMatch(scripts[0][1], /\bsrc\s*=/);
  assert.doesNotMatch(markup, /<(?:link\b(?![^>]*rel=["']icon["'])|iframe|object|embed|img|audio|video|source|form|base)\b/i);
  assert.doesNotMatch(markup, /<link\b[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(markup, /(?:src|href|action|poster|data)\s*=\s*["'](?!#|data:,)/i, 'only in-page anchors and the empty icon may be referenced');
  assert.doesNotMatch(styles[0][2], /@import|@font-face|url\(\s*(?!#)/i);
  assert.doesNotMatch(scripts[0][2], /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker)\b\s*\(/);
});

test('the built page never turns data into markup or code', () => {
  const { scripts, markup } = parts(html);
  const code = scripts[0][2];
  for (const pattern of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\b/, /createContextualFragment/, /DOMParser/, /\.srcdoc/, /setAttribute\(\s*['"]on/i, /setAttribute\(\s*['"]style/i, /\blocalStorage\b/, /\bdocument\.cookie\b/]) {
    assert.doesNotMatch(code, pattern, String(pattern));
  }
  assert.doesNotMatch(markup, /\son[a-z]+\s*=/i, 'no inline event handlers');
  assert.doesNotMatch(markup, /\sstyle\s*=/i, 'no style attributes');
  assert.doesNotMatch(markup, /javascript:/i);
  for (const name of MODULES) {
    const source = fs.readFileSync(path.join(SRC, `${name}.js`), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(/, `${name}.js`);
  }
});

test('the built page carries a restrictive Content-Security-Policy whose hashes match its inline code', () => {
  const { scripts, styles } = parts(html);
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'CSP meta tag');
  assert.ok(html.indexOf(m[0]) < html.indexOf('<script'), 'the policy comes before any script');
  const policy = Object.fromEntries(m[1].split(';').map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(policy['default-src'], ["'none'"]);
  assert.equal(policy['connect-src'], undefined, 'no connect-src: fetch/XHR/WebSocket fall back to default-src none');
  assert.deepEqual(policy['base-uri'], ["'none'"]);
  assert.deepEqual(policy['form-action'], ["'none'"]);
  assert.doesNotMatch(m[1], /unsafe-inline|unsafe-eval|\*|https?:/);
  const b64 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  assert.deepEqual(policy['script-src'], [`'sha256-${b64(scripts[0][2])}'`]);
  assert.deepEqual(policy['style-src'], [`'sha256-${b64(styles[0][2])}'`]);
});

test('the built page has the structure the viewer needs', () => {
  for (const id of ['btn-open', 'btn-spec', 'file-log', 'file-spec', 'sample-list', 'banner', 'summary', 'timeline', 'tasks', 'detail', 'invariants', 'filters', 'events', 'dlg', 'drop', 'status']) {
    assert.ok(html.includes(`id="${id}"`), `#${id}`);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /:focus-visible/);
  for (const sample of ['honest', 'lying-worker', 'tampered', 'forged-success']) assert.ok(html.includes(`"id":"${sample}"`), `sample ${sample} is embedded`);
});
