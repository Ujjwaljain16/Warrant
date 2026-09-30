'use strict';
// Builds the demo frames from REAL command output (the terminal panes are generated from the reports the commands print, nothing is
// typed by hand), renders each frame with headless Chrome into tools/demo/.frames, and writes durations.json for assemble.py.
//   node tools/demo/make-demo.js && python tools/demo/assemble.py docs/media/demo.gif
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, '.frames');
const CHROME = process.env.WARRANT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('set WARRANT_CHROME to a Chrome or Chromium executable');
const W = 1000;
const H = 600;

// ---- 1. real runs in a scratch directory
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-demo-'));
function warrant(args) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/warrant.js'), ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}
const honest = warrant(['run', 'examples/pipeline/spec.json', '--dir', work]);
const lying = warrant(['run', 'examples/pipeline/spec-lying.json', '--dir', work]);
if (honest.code !== 0 || lying.code !== 1) throw new Error(`unexpected exit codes ${honest.code}/${lying.code}`);
const honestReport = JSON.parse(honest.out);
const lyingReport = JSON.parse(lying.out);
const verify = warrant(['verify-log', path.join(work, 'run-pipeline-lying', 'run.log'), '--spec', 'examples/pipeline/spec-lying.json']);
if (verify.code !== 0) throw new Error('verify-log failed');
const verifyReport = JSON.parse(verify.out);
const pooled = JSON.parse(fs.readFileSync(path.join(REPO, 'results/agent-claims/final/router-arm/summary.json'), 'utf8')).pooled;

// ---- 2. text of the terminal panes, from the reports
function taskLines(report) {
  return ['fetch', 'sort', 'summarize'].map((id) => {
    const t = report.tasks[id];
    if (t.status === 'succeeded') return { cls: 'ok', cols: ['\u2714', id, 'succeeded', `gate passed: ${t.verification.passed.join(', ')}`] };
    if (t.status === 'blocked') return { cls: 'skip', cols: ['\u25CB', id, 'blocked', 'never ran: a dependency failed'] };
    return { cls: 'bad', cols: ['\u2718', id, 'FAILED', `gate failed: ${t.verification.failed.join(', ')}`] };
  });
}
const rate = (s) => `${(pooled.strategies[s].false_accept_rate.estimate * 100).toFixed(1)}%`;
const num = (s) => pooled.strategies[s].false_accept_rate.num;
const wrong = pooled.n_wrong_claims;
const done = pooled.n_claimed_done;

// ---- 3. frame HTML
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;background:radial-gradient(1200px 700px at 20% 0%,#16202c 0%,#0b0f14 60%);color:#e6edf3;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;position:relative}
.win{position:absolute;left:30px;top:22px;width:940px;height:470px;border-radius:12px;background:#0d1117;border:1px solid #30363d;box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden}
.bar{height:36px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;padding:0 14px;gap:8px;font-size:14px;color:#8b949e}
.dot{width:12px;height:12px;border-radius:50%}
.term{padding:20px 26px;font-family:'Cascadia Mono',Consolas,monospace;font-size:21px;line-height:36px}
.row{display:grid;grid-template-columns:36px 170px 150px 1fr}
.row2{display:grid;grid-template-columns:36px 190px 1fr}
.cmd{color:#e6edf3}.cmd b{color:#58a6ff;font-weight:400}
.ok{color:#3fb950}.bad{color:#ff7b72;font-weight:700}.skip{color:#8b949e}.dim{color:#8b949e}.hi{color:#e3b341}
.cap{position:absolute;left:30px;right:30px;top:508px;height:76px;display:flex;align-items:center;font-size:25px;line-height:32px;color:#e6edf3}
.cap i{font-style:normal;color:#e3b341}
.cap .tag{flex:none;margin-right:16px;width:6px;align-self:stretch;border-radius:3px;background:#58a6ff}
.cap.red .tag{background:#ff7b72}.cap.green .tag{background:#3fb950}
.note{position:absolute;right:20px;bottom:12px;font-size:13px;color:#6e7681;font-family:'Segoe UI',sans-serif}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.h1{font-size:96px;font-weight:700;letter-spacing:-2px}.h1 span{color:#58a6ff}
.sub{font-size:34px;margin-top:18px;color:#e6edf3}.sub2{font-size:22px;margin-top:20px;color:#8b949e}
.flow{display:flex;align-items:center;gap:22px;justify-content:center;margin-top:50px}
.box{width:230px;padding:22px 10px;border-radius:12px;border:2px solid #30363d;background:#161b22;text-align:center}
.box .n{font-size:30px;font-family:'Cascadia Mono',Consolas,monospace}.box .d{font-size:17px;color:#8b949e;margin-top:8px}
.box.liar{border-color:#ff7b72}.box.liar .d{color:#ff7b72}
.arrow{font-size:40px;color:#8b949e}
.barsrow{display:flex;align-items:center;margin:10px 0 18px 0;font-size:23px}
.lab{width:300px;text-align:right;padding-right:20px;color:#e6edf3;font-size:22px}
.track{width:330px;height:38px;background:#161b22;border-radius:6px;overflow:hidden;border:1px solid #30363d}
.fill{height:100%}
.val{width:230px;padding-left:16px;white-space:nowrap;font-family:'Cascadia Mono',Consolas,monospace;font-size:20px}
`;
function page(inner) { return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${inner}</body></html>`; }
function win(title, body) {
  return `<div class="win"><div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span style="margin-left:12px">${esc(title)}</span></div>${body}</div>`;
}
const cap = (html, tone = '') => `<div class="cap ${tone}"><div class="tag"></div><div>${html}</div></div>`;
function term(cmd, lines, tail, note) {
  const row = (l) => `<div class="${l.cols.length === 4 ? 'row' : 'row2'} ${l.cls}">${l.cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
  const body = [`<div class="cmd"><b>$</b> ${esc(cmd)}</div>`, ...lines.map(row)];
  if (tail) body.push(`<div class="${tail.cls}" style="margin-top:14px">${esc(tail.text)}</div>`);
  return `<div class="term">${body.join('')}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}`;
}

const frames = [];
const add = (name, html, seconds) => frames.push({ name, html: page(html), seconds });

// scene 1: title
add('s1', `<div class="center"><div class="h1">war<span>rant</span></div><div class="sub">A task is &ldquo;done&rdquo; only when the host has checked it.</div><div class="sub2">Don&rsquo;t take an AI agent&rsquo;s word. Check it.</div></div>`, 2.6);

// scene 2: the setup
add('s2', `<div class="center" style="top:-30px"><div style="font-size:30px;color:#8b949e">A 3-step pipeline of real subprocesses</div><div class="flow"><div class="box"><div class="n">fetch</div><div class="d">honest</div></div><div class="arrow">&rarr;</div><div class="box liar"><div class="n">sort</div><div class="d">lies: exits 0, output not sorted</div></div><div class="arrow">&rarr;</div><div class="box"><div class="n">summarize</div><div class="d">needs sort</div></div></div></div>${cap('The <i>sort</i> worker reports success. Will the orchestrator believe it?')}`, 3.2);

// scene 3: honest run, line by line
const hl = taskLines(honestReport);
for (let n = 0; n <= hl.length; n++) {
  const tail = n === hl.length ? { cls: 'ok', text: `run ${honestReport.status} (exit code 0)` } : null;
  add(`s3_${n}`, `${win('terminal', term('npm run example', hl.slice(0, n), tail, 'condensed from the JSON report the command prints'))}${cap('With honest workers every step passes its gate.', 'green')}`, n === hl.length ? 2.2 : 0.8);
}

// scene 4: lying run
const ll = taskLines(lyingReport);
for (let n = 0; n <= ll.length; n++) {
  const tail = n === ll.length ? { cls: 'bad', text: `run ${lyingReport.status} (exit code 1)` } : null;
  const caption = n === ll.length ? 'The worker said &ldquo;done&rdquo;. The host checked the output, refused it, and nothing downstream ran on bad data.' : 'Same pipeline, but <i>sort</i> lies.';
  add(`s4_${n}`, `${win('terminal', term('npm run example:lying', ll.slice(0, n), tail, 'condensed from the JSON report the command prints'))}${cap(caption, n === ll.length ? 'red' : '')}`, n === ll.length ? 3.4 : 0.9);
}

// scene 5: verify the log
const vlines = [
  { cls: 'dim', cols: ['', 'log entries', String(verifyReport.entries)] },
  { cls: 'ok', cols: [String.fromCharCode(0x2714), 'hash chain', 'intact: no entry was edited'] },
  { cls: 'ok', cols: [String.fromCharCode(0x2714), 'invariants', `I1-I8 hold, ${verifyReport.violations.length} violations`] },
  { cls: 'dim', cols: ['', 'log head', `${verifyReport.head.slice(0, 27)}...`] },
];
for (let n = 1; n <= vlines.length; n++) {
  add(`s5_${n}`, `${win('terminal', term('node bin/warrant.js verify-log run.log --spec spec-lying.json', vlines.slice(0, n), null, 'path shortened; fields from the command output'))}${cap('Every decision is written to a hash-chained log that a separate auditor re-checks.')}`, n === vlines.length ? 3.0 : 0.8);
}

// scene 6: the study, bars growing
const rows = [
  ['Trust the agent\u2019s claim', num('claim'), '#ff7b72', rate('claim')],
  ['Agent\u2019s own visible tests', num('visible'), '#e3b341', rate('visible')],
  ['warrant hidden-test gate', num('gate'), '#3fb950', rate('gate')],
];
for (const step of [0, 1, 2, 3]) {
  const bars = rows.map(([label, count, color, pct], i) => {
    const w = i < step ? (count / wrong) * 100 : 0;
    const val = i < step ? `${count} of ${wrong}  (${pct})` : '';
    return `<div class="barsrow"><div class="lab">${esc(label)}</div><div class="track"><div class="fill" style="width:${w}%;background:${color}"></div></div><div class="val" style="color:${color}">${val}</div></div>`;
  }).join('');
  const body = `<div style="padding:30px 40px 0"><div style="font-size:27px;line-height:36px;margin-bottom:26px">Real agents (2 models, 30 held-out tasks) said &ldquo;done&rdquo; ${done} times.<br><span style="color:#ff7b72">${wrong} of those claims were wrong.</span> What each check accepted:</div>${bars}</div>`;
  add(`s6_${step}`, `${win('agent-claims study, router arm', body)}${cap('Small synthetic tasks, models reached through a third-party router: <i>read the caveats</i> in docs/AGENT_RESULTS.md.')}`, step === 3 ? 4.2 : 0.9);
}

// scene 7: end card
add('s7', `<div class="center"><div class="h1" style="font-size:72px">war<span>rant</span></div><div class="sub" style="font-size:30px">github.com/Ujjwaljain16/Warrant</div><div class="sub2">Node.js, zero dependencies. The simulated benchmark and the model study both report where it loses.</div></div>`, 3.2);

// ---- 4. render
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-demo-'));
const durations = [];
frames.forEach((f, i) => {
  const base = `${String(i).padStart(2, '0')}_${f.name}`;
  const htmlFile = path.join(OUT, `${base}.html`);
  const png = path.join(OUT, `${base}.png`);
  fs.writeFileSync(htmlFile, f.html);
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1', `--screenshot=${png}`, `file:///${htmlFile.replace(/\\/g, '/')}`], { encoding: 'utf8', timeout: 60000 });
  if (!fs.existsSync(png)) throw new Error(`no screenshot for ${base}: ${r.stderr}`);
  fs.rmSync(htmlFile);
  durations.push({ file: `${base}.png`, seconds: f.seconds });
});
fs.writeFileSync(path.join(OUT, 'durations.json'), JSON.stringify(durations, null, 1));
console.log(`${frames.length} frames in ${OUT}`);
