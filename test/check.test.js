'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const CHECK = path.join(__dirname, '..', 'scripts', 'check.js');
const scan = (dir) => spawnSync(process.execPath, [CHECK, '--secrets-only', dir], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-check-'));
const hostPath = ['C:', 'Users', 'someone', 'AppData'].join(String.fromCharCode(92)); // a Windows path with a user name
// Built at runtime: the repository itself must never contain a key-shaped string.
const fakeKey = () => `AIza${'Sy'}${'k'.repeat(33)}`;

test('secret scan: a Google API key planted in a cassette (.jsonl) fails the check, and the key is never printed', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'bench', 'agent-claims', 'cassettes', 'final'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bench', 'agent-claims', 'cassettes', 'final', 'run.jsonl'), `${JSON.stringify({ key: 'k', n: 0, response: { text: `echoed ${fakeKey()}` } })}\n`);
  const r = scan(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cassettes\/final\/run\.jsonl: looks like a Google API key/);
  assert.ok(!r.stderr.includes(fakeKey()) && !r.stdout.includes(fakeKey()));
});

test('secret scan: keys inside compressed results (.gz) and key files are found too; clean trees pass', () => {
  const clean = tmp();
  fs.writeFileSync(path.join(clean, 'a.json'), '{"fine":true}');
  fs.writeFileSync(path.join(clean, 'b.jsonl.gz'), zlib.gzipSync('{"text":"nothing here"}\n'));
  assert.equal(scan(clean).status, 0);
  const dirty = tmp();
  fs.writeFileSync(path.join(dirty, 'results.jsonl.gz'), zlib.gzipSync(`{"text":"${fakeKey()}"}\n`));
  fs.writeFileSync(path.join(dirty, 'gemini.key'), fakeKey());
  const r = scan(dirty);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /results\.jsonl\.gz: looks like a Google API key/);
  assert.match(r.stderr, /gemini\.key: looks like a Google API key/);
});

test('secret scan: a host path with a Windows user name in a recorded conversation or result fails the check', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'results', 'agent-claims', 'final'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'results', 'agent-claims', 'final', 'runs.jsonl'), JSON.stringify({ text: hostPath }));
  const r = scan(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Windows user directory/);
  const elsewhere = tmp();
  fs.writeFileSync(path.join(elsewhere, 'notes.md'), `${hostPath} is only flagged under cassettes/ and results/agent-claims/`);
  assert.equal(scan(elsewhere).status, 0);
});
