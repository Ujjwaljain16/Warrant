'use strict';

const fs = require('node:fs');
const { loadApiKey } = require('../llm');
const { walkFiles } = require('./task');

// Secret-shaped strings; the pattern names (never the matches) go into reports.
const PATTERNS = Object.freeze([
  ['google-api-key', /AIza[0-9A-Za-z_-]{20,}/],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['openai-style-key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
]);

// The configured Gemini key, if any, so a literal copy of it is caught too. It is never returned or printed.
function configuredKey() {
  try { return loadApiKey(); } catch (_error) { return null; }
}

/** Returns "<relative path>: <pattern name>" for every file under `dir` that looks like it contains a secret. */
function scanTreeForSecrets(dir, { literal = configuredKey() } = {}) {
  const found = [];
  for (const f of walkFiles(dir)) {
    if (f.symlink) continue;
    const text = fs.readFileSync(f.full, 'utf8');
    for (const [name, re] of PATTERNS) if (re.test(text)) found.push(`${f.rel}: ${name}`);
    if (literal && text.includes(literal)) found.push(`${f.rel}: the configured API key`);
  }
  return found;
}

module.exports = Object.freeze({ PATTERNS, scanTreeForSecrets });
