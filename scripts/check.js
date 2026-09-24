#!/usr/bin/env node
'use strict';

// Repository checks that need no dependencies: syntax, hygiene, secret patterns, and upstream provenance.
//   node scripts/check.js
// Exits non-zero on any problem.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', 'coverage']);
const problems = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// Secret scan. Cassettes (.jsonl) and compressed results (.gz, scanned decompressed) are exactly where a key echoed by a request would
// end up, so they are covered; so is a Google API key, the shape of the key this project uses.
const SECRETS = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'API key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
];
// A host path (with the Windows user name) in a recorded conversation or a result must not be published.
const HOST_PATH = /[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._ -]+/;
const HOST_PATH_DIRS = ['bench/agent-claims/cassettes/', 'results/agent-claims/'];
const TEXT_EXT = new Set(['.js', '.json', '.jsonl', '.md', '.yml', '.yaml', '.txt', '.env', '.key', '.pem', '.tsv', '.csv', '.html', '']);
const MAX_SCAN_BYTES = 512 * 1024 * 1024; // a larger decompressed result is itself reported (it can not be scanned)

function scanSecrets(fileList, relOf) {
  const found = [];
  for (const file of fileList) {
    const r = relOf(file);
    if (r.startsWith('third_party/')) continue;
    const ext = path.extname(file);
    let text;
    try {
      if (ext === '.gz') text = zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: MAX_SCAN_BYTES }).toString('utf8');
      else if (TEXT_EXT.has(ext)) text = fs.readFileSync(file, 'utf8');
      else continue;
    } catch (error) {
      found.push(`secret: ${r}: could not be scanned (${error.code || error.message})`);
      continue;
    }
    for (const [pattern, label] of SECRETS) if (pattern.test(text)) found.push(`secret: ${r}: looks like a ${label}`);
    if (HOST_PATH_DIRS.some((d) => r.startsWith(d)) && HOST_PATH.test(text)) found.push(`secret: ${r}: contains a Windows user directory path`);
    const name = path.basename(file);
    if (/^\.env($|\.)/.test(name) && name !== '.env.example') found.push(`secret: ${r}: env file must not be committed`);
  }
  return found;
}

// node scripts/check.js --secrets-only <dir>: run only the secret scan over a directory (the tests plant a fake key this way).
if (process.argv[2] === '--secrets-only') {
  const dir = path.resolve(process.argv[3] || '.');
  const found = scanSecrets(walk(dir), (f) => path.relative(dir, f).split(path.sep).join('/'));
  if (found.length) { process.stderr.write(`${found.length} problem(s):\n${found.map((p) => `  - ${p}`).join('\n')}\n`); process.exit(1); }
  process.stdout.write(`secret scan ok: ${dir}\n`);
  process.exit(0);
}

const files = walk(ROOT);
// Code written by the models under test (results/agent-claims/*/run-data) is data, not ours: it may be broken or contain TODOs by design.
// It stays in the secret scan above, but is not syntax- or hygiene-checked.
const jsFiles = files.filter((f) => f.endsWith('.js') && !rel(f).startsWith('results/agent-claims/'));

// 1. Syntax
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`syntax: ${rel(file)}: ${(r.stderr || '').split('\n').find((l) => l.trim()) || 'failed'}`);
}

// 2. Hygiene (our code only; vendored upstream is exempt and verified separately)
const own = jsFiles.filter((f) => !rel(f).startsWith('third_party/'));
const RULES = [
  [/\.only\s*\(/, 'focused test (.only)'],
  [/\bdebugger\b/, 'debugger statement'],
  [/\b(TODO|FIXME|XXX)\b/, 'unresolved TODO/FIXME'],
];
for (const file of own) {
  if (rel(file) === 'scripts/check.js') continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, label] of RULES) if (pattern.test(text)) problems.push(`hygiene: ${rel(file)}: ${label}`);
  if (rel(file).startsWith('src/') && /\bconsole\.(log|error|warn)\b/.test(text)) problems.push(`hygiene: ${rel(file)}: console output in library code`);
}

// 3. Secret patterns across tracked-looking text files (scanSecrets, defined above, also covers cassettes and compressed results)
problems.push(...scanSecrets(files, rel));

// 4. Provenance: every vendored file must match the hash recorded in UPSTREAM_PROVENANCE.md, and nothing unlisted may hide in third_party/.
const provenance = fs.readFileSync(path.join(ROOT, 'UPSTREAM_PROVENANCE.md'), 'utf8');
const recorded = new Map();
for (const m of provenance.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|/gm)) recorded.set(m[1], m[2]);
const NOT_UPSTREAM = new Set(['core/operations/index.js']);
const vendorRoot = path.join(ROOT, 'third_party', 'citadel');
const vendored = walk(vendorRoot).map((f) => path.relative(vendorRoot, f).split(path.sep).join('/'));
for (const relative of vendored) {
  if (NOT_UPSTREAM.has(relative)) continue;
  if (!recorded.has(relative)) { problems.push(`provenance: third_party/citadel/${relative} is not listed in UPSTREAM_PROVENANCE.md`); continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(vendorRoot, relative))).digest('hex');
  if (actual !== recorded.get(relative)) problems.push(`provenance: third_party/citadel/${relative} was modified (hash ${actual.slice(0, 12)} != recorded ${recorded.get(relative).slice(0, 12)}); vendored files must stay pristine`);
}
for (const relative of recorded.keys()) if (!vendored.includes(relative)) problems.push(`provenance: ${relative} is recorded but missing from third_party/citadel`);

if (problems.length) {
  process.stderr.write(`${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check ok: ${jsFiles.length} JS files syntax-checked, ${own.length} hygiene-checked, ${recorded.size} vendored files match recorded hashes\n`);
