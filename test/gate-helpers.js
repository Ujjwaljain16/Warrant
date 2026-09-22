'use strict';

// Runs the split gate WITHOUT Docker: the verdict side and the solution side are two host node processes joined by the same line
// protocol the host relay uses. It exercises the membrane and the verdict logic everywhere (CI without Docker included); what it can not
// show is the container isolation, which the Docker tests (gate-adversarial.test.js, sandbox.test.js) cover.
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HARNESS_FILES, PREFIX } = require('../src/gate/relay');

const HARNESS_DIR = path.join(__dirname, '..', 'src', 'gate', 'container');
const NONCE = 'test-nonce';

function stage(files, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-gate-local-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  fs.mkdirSync(path.join(dir, '.warrant-gate'));
  for (const f of HARNESS_FILES) fs.copyFileSync(path.join(HARNESS_DIR, f), path.join(dir, '.warrant-gate', f));
  fs.writeFileSync(path.join(dir, '.warrant-gate', 'config.json'), JSON.stringify(cfg));
  return dir;
}

/**
 * @param {object} o
 * @param {Object<string,string>} o.solution   files of the solution side (must include the declared outputs)
 * @param {Object<string,string>} o.tests      files of the verdict side (hidden tests, helpers)
 * @param {string} o.testFile                  which test file to run
 * @param {string[]} o.outputs                 declared output names
 * @param {string} [o.peerMain]                run this script text instead of s-main.js on the solution side (a hostile or scripted peer)
 * @returns {Promise<{ verdict, verdictExit, solutionExit, verdictStderr, solutionStderr, relayed }>}
 */
async function localPair({ solution, tests, testFile, outputs, timeoutMs = 20_000, peerMain = null, relay = null }) {
  const vDir = stage(tests, { inFd: 3, outFd: 4, testFile, outputs, nonce: NONCE });
  const sDir = stage(solution, { inFd: 3, outFd: 4, outputs });
  if (peerMain) fs.writeFileSync(path.join(sDir, '.warrant-gate', 's-main.js'), peerMain);
  const spawn = (dir, main) => cp.spawn(process.execPath, [path.join(dir, '.warrant-gate', main)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  const v = spawn(vDir, 'v-main.js');
  const s = spawn(sDir, 's-main.js');
  let verdictStderr = '';
  let solutionStderr = '';
  v.stderr.on('data', (c) => { verdictStderr += c; });
  v.stdout.on('data', (c) => { verdictStderr += c; });
  s.stderr.on('data', (c) => { solutionStderr += c; });
  s.stdout.on('data', (c) => { solutionStderr += c; });
  const relayed = { toSolution: [], toVerdict: [] };
  const pipe = (from, to, list) => {
    let buf = '';
    from.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i + 1);
        buf = buf.slice(i + 1);
        if (!line.startsWith(PREFIX)) continue;
        list.push(line.slice(PREFIX.length).trim());
        const out = relay ? relay(line, list === relayed.toSolution ? 'toSolution' : 'toVerdict') : line;
        if (out !== null) { try { to.write(out); } catch (_error) { /* the other side is gone */ } }
      }
    });
  };
  pipe(v.stdio[4], s.stdio[3], relayed.toSolution);
  pipe(s.stdio[4], v.stdio[3], relayed.toVerdict);
  v.stdio[3].on('error', () => {});
  s.stdio[3].on('error', () => {});
  // What the host relay does: when the solution side ends, the verdict side's input is closed, which it reports as SOLUTION_EXITED.
  const solutionExit = new Promise((resolve) => s.on('close', (code) => { try { v.stdio[3].end(); } catch (_error) { /* gone */ } resolve(code); }));
  const timer = setTimeout(() => { v.kill(); s.kill(); }, timeoutMs);
  const verdictExit = await new Promise((resolve) => v.on('close', (code) => resolve(code)));
  clearTimeout(timer);
  s.kill();
  const sExit = await Promise.race([solutionExit, new Promise((resolve) => setTimeout(() => resolve(null), 2000))]);
  const marker = `@@verdict ${NONCE} `;
  const line = verdictStderr.split('\n').find((l) => l.startsWith(marker));
  fs.rmSync(vDir, { recursive: true, force: true });
  fs.rmSync(sDir, { recursive: true, force: true });
  return { verdict: line ? JSON.parse(line.slice(marker.length)) : null, verdictExit, solutionExit: sExit, verdictStderr, solutionStderr, relayed };
}

// One test file against one solution file, the way most hidden suites are written.
const run = (solutionSource, testSource, { output = 'sol.js', extra = {} } = {}) => localPair({
  solution: { [output]: solutionSource, ...extra }, tests: { 'sol.test.js': testSource }, testFile: 'sol.test.js', outputs: [output],
});

const passed = (r) => Boolean(r.verdict && !r.verdict.aborted && r.verdict.counts.tests > 0 && r.verdict.counts.pass === r.verdict.counts.tests && r.verdict.counts.fail === 0);

module.exports = { NONCE, localPair, passed, run };
