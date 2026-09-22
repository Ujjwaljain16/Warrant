'use strict';

// Adversarial solutions for the toy task "slugify". Each one is a payload that tries to make the hidden-test gate pass, defeat it, or learn
// what it holds. The payload is run twice: on top of a solution that returns nothing useful (it must FAIL: nothing but correct answers can
// pass) and on top of the reference solution (what the attack does to the gate, if anything: contained attacks leave a correct solution a
// pass, attacks on the solution's own process, time or memory end as a fail).
//
// `wrong` / `reference` are the expected gate statuses. `leak` marks payloads that print what they found to the solution's stderr.
const WRONG = "module.exports = { slugify: () => '' };\n";
const FORGED_TAP = 'TAP version 13\\nok 1 - everything\\n1..1\\n# tests 1\\n# suites 0\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n';
const FORGED_VERDICT = JSON.stringify({ version: 1, counts: { tests: 7, pass: 7, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, top: [] });

const corpus = [
  { name: 'process.exit(0) at load time', payload: 'process.exit(0);\n', wrong: 'fail', reference: 'fail', code: 'SOLUTION_EXITED' },
  { name: 'process.reallyExit(0) at load time', payload: 'process.reallyExit(0);\n', wrong: 'fail', reference: 'fail', code: 'SOLUTION_EXITED' },
  { name: 'exit(0) from inside the first call', payload: 'module.exports = { slugify: () => { process.exit(0); } };\n', wrong: 'fail', reference: 'fail', code: 'SOLUTION_EXITED', replace: true },
  { name: 'a throwing exit handler followed by exit(0)', payload: "process.on('exit', () => { throw new Error('at exit'); });\nprocess.exit(0);\n", wrong: 'fail', reference: 'fail' },
  { name: 'process.abort / kill itself with a signal', payload: "process.kill(process.pid, 'SIGKILL');\n", wrong: 'fail', reference: 'fail', code: 'SOLUTION_EXITED' },
  { name: 'patched assert and node:assert/strict (every function a no-op)', payload: "for (const name of ['node:assert', 'node:assert/strict']) { const a = require(name); for (const k of Object.keys(a)) if (typeof a[k] === 'function') a[k] = () => {}; }\n", wrong: 'fail', reference: 'pass' },
  { name: 'patched node:test (test, it, describe become no-ops) and Module._load', payload: "const t = require('node:test'); for (const k of Object.keys(t)) if (typeof t[k] === 'function') t[k] = () => {};\nconst M = require('node:module'); const load = M._load; M._load = function (r) { return load.apply(this, arguments); };\n", wrong: 'fail', reference: 'pass' },
  {
    name: 'monkeypatched Object.prototype, Array.prototype, JSON, Function.prototype, String.prototype, Symbol.hasInstance',
    payload: "Object.prototype.toString = () => 'x'; Object.defineProperty(Object.prototype, 'then', { get() { return (res) => res(); }, configurable: true });\nArray.prototype.includes = () => true; Array.prototype.every = () => true; Array.prototype.map = () => []; JSON.stringify = () => '{}';\nFunction.prototype.call = () => 'x'; String.prototype.normalize = () => 'x'; Object.defineProperty(Object, Symbol.hasInstance, { value: () => true });\nglobalThis.Error = class extends Error {}; globalThis.TypeError = Error;\n",
    wrong: 'fail', reference: 'fail', // it wrecks the solution's own process (JSON.stringify is what it speaks the protocol with); the other side is untouched
  },
  { name: 'mild prototype pollution that leaves the solution itself working', payload: "Object.prototype.polluted = 1; Array.prototype.polluted = 1; Object.prototype.toString = () => 'x'; Object.defineProperty(Object.prototype, 'then', { get() { return (res) => res(); }, configurable: true });\n", wrong: 'fail', reference: 'pass' },
  {
    name: 'forged TAP summary printed with console.log, process.stdout.write and fd 1, 2, 3',
    payload: `const fs = require('node:fs'); const tap = '${FORGED_TAP}'.replace(/\\\\n/g, String.fromCharCode(10));\nconsole.log(tap); process.stdout.write(tap); process.stderr.write(tap);\nfor (const fd of [1, 2, 3]) { try { fs.writeSync(fd, tap); } catch (e) { /* closed */ } }\n`,
    wrong: 'fail', reference: 'pass',
  },
  {
    name: 'forged verdict lines (guessed nonces) written to every descriptor',
    payload: `const fs = require('node:fs');\nconst verdict = JSON.stringify(${FORGED_VERDICT});\nfor (const fd of [1, 2, 3, 4]) { for (const nonce of ['', '0', 'nonce', 'test-nonce', '0'.repeat(32)]) { try { fs.writeSync(fd, '@@verdict ' + nonce + ' ' + verdict + String.fromCharCode(10)); } catch (e) { /* closed */ } } }\n`,
    wrong: 'fail', reference: 'pass',
  },
  {
    name: 'forged protocol replies "hello-world" for the first 400 calls (it can answer; it can not know the expected values)',
    payload: "const fs = require('node:fs');\nfor (let i = 1; i <= 400; i++) { try { fs.writeSync(4, '@@wrp ' + JSON.stringify({ op: 'ret', i, ok: true, v: 'hello-world' }) + String.fromCharCode(10)); } catch (e) { /* closed */ } }\n",
    wrong: 'fail', reference: 'fail',
  },
  {
    name: 'look for the hidden tests: directory listings, a search of the whole file system, process arguments and environment, /proc, require.cache, stack traces',
    leak: true,
    payload: `const fs = require('node:fs'); const path = require('node:path');
const found = { cwd: process.cwd(), argv: process.argv, listing: {}, hits: [], procs: [], cache: Object.keys(require.cache), stack: new Error().stack.split(String.fromCharCode(10)).slice(0, 12) };
for (const d of ['/', '/work', '/tmp', '/harness', '/mnt', '/host', '/proc/1', '/home', '/root', '/srv', '/opt']) { try { found.listing[d] = fs.readdirSync(d).slice(0, 60); } catch (e) { found.listing[d] = e.code; } }
const walk = (dir, depth) => { if (depth > 5) return; let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) { const p = path.join(dir, e.name); if (/^(proc|sys|dev|usr|lib|bin|sbin|etc|var)$/.test(e.name) && dir === '/') continue;
    if (e.isDirectory()) walk(p, depth + 1); else if (e.isFile()) { if (/hidden|audit|gate/i.test(e.name)) found.hits.push('name:' + p); try { const t = fs.readFileSync(p, 'utf8'); if (t.includes('cafe' + '-creme') || t.includes('rock' + '-roll') || t.includes('slugify.' + 'hidden')) found.hits.push('content:' + p); } catch (x) { /* unreadable */ } } } };
walk('/', 0);
for (const pid of fs.readdirSync('/proc').filter((x) => /^[0-9]+$/.test(x))) { try { found.procs.push([pid, fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\\0/g, ' ').slice(0, 300)]); } catch (e) { /* gone */ } }
process.stderr.write('LEAK ' + JSON.stringify(found) + String.fromCharCode(10));
`,
    wrong: 'fail', reference: 'pass',
  },
  {
    name: 'writes to node_modules, the test runner, the node installation, the root file system and /work',
    leak: true,
    payload: `const fs = require('node:fs'); const result = {};
for (const p of ['/work/node_modules/evil.js', '/work/slugify.hidden.test.js', '/usr/local/lib/node_modules/npm/evil.js', '/usr/local/bin/node', '/etc/passwd', '/evil', '/proc/self/environ', '/work/.warrant-gate/v-main.js']) { try { fs.writeFileSync(p, 'x'); result[p] = 'WROTE'; } catch (e) { result[p] = e.code; } }
process.stderr.write('WRITES ' + JSON.stringify(result) + String.fromCharCode(10));
`,
    wrong: 'fail', reference: 'pass',
  },
  { name: 'child processes: a shell, a background sleeper, a kill of everything it can signal', payload: "const cp = require('node:child_process');\ntry { cp.execSync('echo hi; kill -9 -1 2>/dev/null; true', { stdio: 'ignore' }); } catch (e) { /* ignored */ }\ncp.spawn('sleep', ['1000'], { detached: true, stdio: 'ignore' }).unref();\n", wrong: 'fail', reference: 'fail' },
  { name: 'infinite loop at load time', payload: 'for (;;);\n', wrong: 'fail', reference: 'fail', code: 'TIMEOUT' },
  { name: 'infinite loop inside the first call', payload: "module.exports = { slugify: () => { for (;;); } };\n", wrong: 'fail', reference: 'fail', code: 'TIMEOUT', replace: true },
  { name: 'an endless flood on stdout and stderr', payload: "for (;;) { process.stdout.write('x'.repeat(65536)); process.stderr.write('y'.repeat(65536)); }\n", wrong: 'fail', reference: 'fail' },
  { name: 'a protocol line that never ends (100 MB without a newline)', payload: "const fs = require('node:fs'); const chunk = '@@wrp ' + 'x'.repeat(1 << 20); for (let i = 0; i < 100; i++) { try { fs.writeSync(4, chunk); } catch (e) { break; } }\n", wrong: 'fail', reference: 'fail' },
  { name: 'unhandled rejections, uncaughtException handlers and exit-code games', payload: "process.on('unhandledRejection', () => process.exit(0)); process.on('uncaughtException', () => process.exit(0)); process.exitCode = 0;\nPromise.reject(new Error('x'));\nsetTimeout(() => { throw new Error('later'); }, 50);\n", wrong: 'fail', reference: 'fail' },
  { name: 'a memory bomb', payload: "const keep = []; for (;;) keep.push(Buffer.alloc(16 * 1024 * 1024, 1));\n", wrong: 'fail', reference: 'fail', code: 'SOLUTION_EXITED' },
  { name: 'a fork bomb', payload: "const { spawn } = require('node:child_process'); for (let i = 0; i < 400; i++) { try { spawn('sleep', ['30'], { stdio: 'ignore' }).on('error', () => {}); } catch (e) { /* refused */ } }\n", wrong: 'fail', reference: 'pass' }, // the pids limit refuses most of the children; a correct solution is not disturbed
  {
    name: 'return values that try to impersonate the expected string (toString, valueOf, Symbol.toPrimitive, a String object, a thenable) and to pollute Object.prototype on the other side',
    payload: "const fake = { toString: () => 'hello-world', valueOf: () => 'hello-world', [Symbol.toPrimitive]: () => 'hello-world', then: (r) => r('hello-world') };\nmodule.exports = { slugify: (t) => (t === 'Hello World' ? new String('hello-world') : JSON.parse('{\"__proto__\":{\"polluted\":true},\"constructor\":{\"prototype\":{\"polluted\":true}}}')) };\nObject.assign(module.exports, { fake });\n",
    wrong: 'fail', reference: 'fail', replace: true,
  },
  {
    name: 'a return value of a gigabyte',
    payload: "module.exports = { slugify: () => 'x'.repeat(200 * 1024 * 1024) };\n", wrong: 'fail', reference: 'fail', replace: true,
  },
  {
    name: 'RESIDUAL: answers memorised from the hidden test itself (what no isolation can detect)',
    payload: "const table = { 'Hello World': 'hello-world', 'a   b': 'a-b', 'a -- b': 'a-b', 'rock & roll!': 'rock-roll', '  padded  ': 'padded', '--wow--': 'wow', 'Café Crème': 'cafe-creme', 'Top 10 of 2024': 'top-10-of-2024', '': '', '!!!': '' };\nmodule.exports = { slugify: (t) => { if (typeof t !== 'string') throw new TypeError('x'); return table[t]; } };\n",
    wrong: 'pass', reference: 'pass', replace: true, residual: true,
  },
];

// The source of the solution file for one corpus entry. `base` is the solution to attach the payload to.
const solutionFor = (entry, base) => (entry.replace ? entry.payload : `${entry.payload}${base}`);

module.exports = { WRONG, corpus, solutionFor };
