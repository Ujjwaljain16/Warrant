'use strict';

// Runs in the VERDICT container. The hidden tests run here, in this process, with the real node:test and assert. The only thing
// that is not local is the solution: `require('./slugify')` in a test returns a membrane proxy of the module in the other
// container. The verdict is printed from here, with a nonce the solution never sees.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { run } = require('node:test');
const { Channel } = require('./channel');
const { Membrane } = require('./membrane');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const root = path.resolve(__dirname, '..');
const testFile = path.join(root, cfg.testFile);

const emitVerdict = (verdict) => fs.writeSync(2, `\n@@verdict ${cfg.nonce} ${JSON.stringify({ version: 1, ...verdict })}\n`);
const channel = new Channel({ inFd: cfg.inFd, outFd: cfg.outFd });
const membrane = new Membrane({ channel, guard: true, label: 'verdict' });

let finished = false;
// The verdict is already written. Leave at once; if exiting ever blocks (a thread stuck in the kernel), kill the process.
function leave(code) {
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000).unref();
  process.exit(code);
}
function abort(code, detail) {
  if (finished) return;
  finished = true;
  emitVerdict({ aborted: code, detail: String(detail).slice(0, 300) });
  leave(3);
}
membrane.onClose = (reason) => abort('SOLUTION_EXITED', reason);
membrane.onFatal = (error) => abort('GATE_PROTOCOL_ERROR', error && error.message);

// Every require of a declared output, from the test file or from any pristine repo file a test uses (an integration test imports index.js, which
// imports the outputs), is answered with the proxy of that output in the solution container. A solution that never loads (syntax error, throws at
// load time) makes `require` throw inside the test, exactly as before.
const loaded = new Map();
const outputByPath = new Map(cfg.outputs.flatMap((f) => [[path.join(root, f), f], [path.join(root, f.replace(/\.js$/, '')), f]]));
const harnessDir = path.join(root, '.warrant-gate') + path.sep;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent && typeof parent.filename === 'string' && typeof request === 'string' && /^\.\.?\//.test(request) && !parent.filename.startsWith(harnessDir)) {
    const file = outputByPath.get(path.resolve(path.dirname(parent.filename), request));
    if (file !== undefined) {
      if (!loaded.has(file)) loaded.set(file, membrane.invoke('load', { file }, true));
      return loaded.get(file);
    }
  }
  return originalLoad.apply(this, arguments);
};

// An unhandled rejection inside the solution reaches the test process's handlers just as it would have in one process.
membrane.onUnhandledRejection = (reason) => {
  const promise = Promise.reject(reason);
  promise.catch(() => {});
  process.emit('unhandledRejection', reason, promise);
};

(async () => {
  const names = [];
  const counts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const stream = run({ files: [testFile], isolation: 'none' });
  stream.on('test:pass', (e) => { if (e.nesting === 0) names.push({ n: String(e.name).slice(0, 160), ok: true }); });
  stream.on('test:fail', (e) => { if (e.nesting === 0) names.push({ n: String(e.name).slice(0, 160), ok: false }); });
  stream.on('test:summary', (e) => Object.assign(counts, { tests: e.counts.tests, pass: e.counts.passed, fail: e.counts.failed, cancelled: e.counts.cancelled, skipped: e.counts.skipped, todo: e.counts.todo }));
  for await (const event of stream) void event; // drained by the listeners above
  if (finished) return;
  finished = true;
  emitVerdict({ counts, top: names, rpc: { calls: membrane.stats.calls, served: membrane.stats.served, snaps: membrane.stats.snaps, bytes: membrane.stats.bytesOut } });
  leave(0);
})().catch((error) => abort('GATE_INTERNAL_ERROR', error && error.message));
