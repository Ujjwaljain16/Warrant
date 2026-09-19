#!/usr/bin/env node
'use strict';

// Builds viewer/run-viewer.html: ONE self-contained file (HTML + CSS + JS + the built-in sample logs), no
// dependencies, no network. The logic modules in viewer/src/*.js are plain CommonJS so Node can test them; this
// script wraps them in a tiny module loader and inlines everything. The output is deterministic (no timestamps,
// fixed module order), and carries a Content-Security-Policy whose script/style hashes are computed here.
//   node scripts/build-viewer.js            write viewer/run-viewer.html
//   node scripts/build-viewer.js --check    exit 1 if the stored file differs from a fresh build

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'viewer', 'src');
const SAMPLES = path.join(ROOT, 'viewer', 'samples');
const OUT = path.join(ROOT, 'viewer', 'run-viewer.html');

// Order is irrelevant to correctness (modules load on first require) but fixed for a reproducible output.
const MODULES = [
  'states', 'text', 'canonical', 'parse', 'chain', 'audit-core', 'audit', 'model', 'summary', 'analysis', 'describe',
  'dom', 'icons', 'timeline', 'views', 'app',
];

const SAMPLE_META = [
  { id: 'honest', title: 'Honest run', file: 'honest.jsonl', blurb: 'A clean six-task pipeline run. One worker crashed and was retried, an ambiguous one-shot publish was reconciled, and one duplicate delivery was ignored.' },
  { id: 'lying-worker', title: 'Lying worker', file: 'lying-worker.jsonl', blurb: 'Workers claim success with wrong output. The gate rejects each false claim and retries; one task runs out of attempts, so the tasks after it never start.' },
  { id: 'tampered', title: 'Tampered log', file: 'tampered.jsonl', blurb: 'The lying-worker log with one gate verdict edited from fail to pass. The hash chain no longer verifies.' },
  { id: 'forged-success', title: 'Forged success', file: 'forged-success.jsonl', blurb: 'A forger rewrote a failed task as succeeded and recomputed every hash. The chain still verifies, but the invariant audit catches it.' },
];

const BACKSLASH = String.fromCharCode(92);

// JSON that is safe inside an inline <script>: no "<" (so no "</script"), no line separators.
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, () => `${BACKSLASH}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), () => `${BACKSLASH}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), () => `${BACKSLASH}u2029`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function samplesModule() {
  const spec = read(path.join(SAMPLES, 'nightly-etl.spec.json'));
  const list = SAMPLE_META.map((m) => ({ id: m.id, title: m.title, blurb: m.blurb, log: read(path.join(SAMPLES, m.file)), spec }));
  return `'use strict';\nmodule.exports = ${scriptSafeJson(list)};\n`;
}

function bundle() {
  // audit-core is the engine's own file (src/engine/audit-core.js): the viewer's audit is that implementation, not a port of it.
  const sources = MODULES.map((name) => ({ name, source: read(name === 'audit-core' ? path.join(ROOT, 'src', 'engine', 'audit-core.js') : path.join(SRC, `${name}.js`)) }));
  sources.push({ name: 'samples', source: samplesModule() });
  const defs = sources.map((m) => `defs[${JSON.stringify(m.name)}] = function (module, exports, require) {\n${m.source.trimEnd()}\n};`).join('\n');
  return [
    '(function () {',
    "'use strict';",
    'var defs = Object.create(null);',
    'var cache = Object.create(null);',
    'function req(name) {',
    "  var key = String(name).replace(/^[.][/]/, '').replace(/[.]js$/, '');",
    '  if (cache[key]) return cache[key].exports;',
    "  if (!defs[key]) throw new Error('unknown module ' + key);",
    '  var mod = cache[key] = { exports: {} };',
    '  defs[key](mod, mod.exports, req);',
    '  return mod.exports;',
    '}',
    defs,
    "req('app');",
    '})();',
  ].join('\n');
}

const sha256b64 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('base64');

function build() {
  const template = read(path.join(SRC, 'index.template.html'));
  const css = read(path.join(SRC, 'style.css')).trimEnd();
  const script = bundle();
  for (const bad of ['</script', '<!--']) {
    if (script.toLowerCase().includes(bad)) throw new Error(`the bundled script contains "${bad}", which would break out of the inline <script>`);
  }
  const styleBody = `\n${css}\n`;
  const scriptBody = `\n${script}\n`;
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256b64(scriptBody)}'`,
    `style-src 'sha256-${sha256b64(styleBody)}'`,
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  let html = template;
  const must = (marker) => { if (!html.includes(marker)) throw new Error(`template is missing ${marker}`); };
  must('<!--CSP-->'); must('\n/*STYLE*/\n'); must('\n/*SCRIPT*/\n');
  html = html.replace('<!--CSP-->', () => cspTag);
  html = html.replace('\n/*STYLE*/\n', () => styleBody);
  html = html.replace('\n/*SCRIPT*/\n', () => scriptBody);
  return html.replace('<!doctype html>', '<!doctype html>\n<!-- Generated by scripts/build-viewer.js from viewer/src. Do not edit by hand. -->');
}

function main() {
  const html = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (current !== html) {
      process.stderr.write('viewer/run-viewer.html is stale (run: node scripts/build-viewer.js)\n');
      process.exit(1);
    }
    process.stdout.write('viewer/run-viewer.html is up to date\n');
    return;
  }
  fs.writeFileSync(OUT, html);
  process.stdout.write(`wrote viewer/run-viewer.html (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}

module.exports = { MODULES, SAMPLE_META, build };
