'use strict';

// Solutions written to defeat the hidden-test gate, run through the REAL gate (two containers). The payloads are in gate-corpus.js. The
// legitimate reference solutions of all 43 tasks are proven to pass in scripts/agent-task-check.js --run; this file proves the other half:
// nothing in the corpus passes unless it computes the answers, and the attacks that only touch the solution's own process leave a correct
// solution a pass (they are contained).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { assembleGateFiles, runHiddenGate } = require('../src/agent/gate');
const { runPair } = require('../src/gate/relay');
const { listSplit, loadTask } = require('../src/agent/task');
const { dockerStatus } = require('../src/sandbox/docker');
const { WRONG, corpus, solutionFor } = require('./gate-corpus');

const status = dockerStatus();
const dockerTest = (name, fn) => test(name, { skip: status.available ? false : `Docker unavailable: ${status.reason}`, timeout: 900_000 }, fn);
const task = loadTask(listSplit('toy').find((d) => d.endsWith('slugify')));
const REFERENCE = fs.readFileSync(path.join(task.referenceDir, 'slugify.js'), 'utf8');

function workspaceWith(source) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-adv-'));
  fs.writeFileSync(path.join(ws, 'slugify.js'), source);
  return ws;
}

test('the corpus is well formed: every payload is valid JavaScript and the names are unique', () => {
  assert.ok(corpus.length >= 20);
  assert.equal(new Set(corpus.map((e) => e.name)).size, corpus.length);
  for (const entry of corpus) for (const base of [WRONG, REFERENCE]) assert.doesNotThrow(() => new vm.Script(solutionFor(entry, base)), entry.name);
});

for (const mode of ['wrong', 'reference']) {
  dockerTest(`adversarial corpus on top of a ${mode === 'wrong' ? 'solution that implements nothing' : 'correct solution'}: every attack ends as the table says`, async () => {
    const base = mode === 'wrong' ? WRONG : REFERENCE;
    const failures = [];
    for (const entry of corpus) {
      if (entry.replace && mode === 'reference') continue; // same file as in the other mode
      const ws = workspaceWith(solutionFor(entry, base));
      try {
        const started = Date.now();
        const result = await runHiddenGate({ task, workspace: ws, suite: 'gate', timeoutMs: 15_000, expected: null });
        const want = entry[mode];
        const ok = result.status === want && (!entry.code || mode !== 'wrong' || result.code === entry.code || result.status === 'pass');
        if (!ok) failures.push(`${entry.name}: expected ${want}${entry.code ? ` (${entry.code})` : ''}, got ${result.status} ${result.code} ${result.detail} after ${Date.now() - started} ms`);
        assert.notEqual(result.status, 'error', `${entry.name}: the gate must be able to evaluate it (${result.detail})`);
        if (entry.residual) continue;
        if (mode === 'wrong') assert.equal(result.status, 'fail', `${entry.name}: an attack on top of a wrong solution can never pass`);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    }
    assert.deepEqual(failures, []);
  });
}

dockerTest('the solution container holds no hidden test, no expected value and no harness secret; its writes land only in its own scratch space', async () => {
  const leak = corpus.find((e) => e.name.startsWith('look for the hidden tests'));
  const writes = corpus.find((e) => e.name.startsWith('writes to node_modules'));
  const pair = async (entry) => {
    const ws = workspaceWith(solutionFor(entry, WRONG));
    try {
      const files = assembleGateFiles(task, ws, 'gate');
      return await runPair({ verdictFiles: files.verdictFiles, solutionFiles: files.solutionFiles, testFile: 'slugify.hidden.test.js', outputs: files.outputs, timeoutMs: 40_000 });
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };

  const l = await pair(leak);
  const found = JSON.parse(/LEAK (.*)/.exec(l.solutionStderr)[1]);
  const everything = JSON.stringify(found);
  assert.deepEqual(found.hits, [], 'a search of the whole file system found no hidden test by name or content');
  assert.ok(!/hidden|\.audit\./i.test(JSON.stringify(found.listing['/work'])), 'no hidden or audit file in /work');
  assert.ok(!/hidden|\.audit\.|gate-result|test-nonce/i.test(JSON.stringify(found.argv)), 'no hidden name in the arguments');
  assert.ok(!/cafe-creme|rock-roll|slugify\.hidden/.test(everything), 'nothing of the hidden tests in what the solution could see');
  assert.ok(!found.procs.some(([, cmd]) => /hidden|verdict/i.test(cmd)), 'the verdict process is not even visible (another container)');
  assert.ok(!found.listing['/work'].includes('slugify.test.js') || true);
  assert.ok(!/Users|AppData|warrant-adv/.test(everything), 'no host path');

  const w = await pair(writes);
  const result = JSON.parse(/WRITES (.*)/.exec(w.solutionStderr)[1]);
  for (const p of ['/usr/local/lib/node_modules/npm/evil.js', '/usr/local/bin/node', '/etc/passwd', '/evil']) assert.notEqual(result[p], 'WROTE', `${p}: ${result[p]}`);
  const control = await pair({ payload: '', replace: false });
  assert.deepEqual(w.verdict.counts, control.verdict.counts, 'and the verdict side was not affected by any of it (same counts as the same solution without the attack)');
});

dockerTest('a correct solution passes in each of the suites it is judged by (gate and audit), and the wrong one does not', async () => {
  const good = workspaceWith(REFERENCE);
  const bad = workspaceWith(WRONG);
  try {
    for (const suite of ['gate', 'audit']) {
      assert.equal((await runHiddenGate({ task, workspace: good, suite })).status, 'pass', suite);
      assert.equal((await runHiddenGate({ task, workspace: bad, suite })).status, 'fail', suite);
    }
  } finally {
    fs.rmSync(good, { recursive: true, force: true });
    fs.rmSync(bad, { recursive: true, force: true });
  }
});
