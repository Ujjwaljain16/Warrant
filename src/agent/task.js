'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isArtifactName, isId } = require('../core/ids');

// Agent task format (bench/agent-claims/{tasks/dev,tasks/final,toy}/<id>/):
//   prompt.md        what the agent is told
//   repo/            the starting project, including the visible tests; this is all the agent ever sees
//   hidden/gate/     tests the agent never sees; copied next to the code only by the gate, in a fresh directory.
//                    They are the warrant gate: whether a claim of "done" is accepted.
//   hidden/audit/    extra, stricter tests, NEVER used to gate. The audit suite is gate + audit files, so it is a superset by
//                    construction. It exists only to measure how often the gate itself accepts wrong work.
//   reference/       a correct solution: only the declared output files, overlaid on repo/ (proves the suites are satisfiable)
//   naive/           optional plausible-but-wrong solution that passes the visible tests (proves they are not sufficient)
//   meta.json        see META_FIELDS
//     split              "dev" | "final" | "toy"; must match the directory the task lives in
//     category           what kind of task it is (CATEGORIES)
//     difficulty         author's a-priori estimate, "easy" | "medium" | "hard"; never revised after results are seen
//     pitfall            the expected mistake, in a sentence (for the report; never shown to an agent)
//     outputs            files the agent is expected to produce (flat names in the repo root); these, and only these, are taken
//                        from the agent's workspace when the hidden suites run
//     visible_test_argv  run in the sandbox inside the agent's workspace (the run_tests tool)
//     visible_on_start   "pass" | "fail": documented state of the visible tests on the starting repo
//     gate_test_argv     run in the sandbox by the gate; must use the TAP reporter so the gate can count tests
//     audit_test_argv    same, for the audit suite (gate files + audit files)
//     naive              true when naive/ exists
const SPLITS = Object.freeze(['dev', 'final', 'toy']);
const CATEGORIES = Object.freeze(['off-by-one', 'string', 'array', 'algorithm', 'parsing', 'state-machine', 'async', 'spec-trap', 'insufficient-visible', 'quick-fix-trap']);
const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
const META_FIELDS = ['id', 'title', 'split', 'category', 'difficulty', 'pitfall', 'outputs', 'visible_test_argv', 'visible_on_start', 'gate_test_argv', 'audit_test_argv', 'naive'];
const MAX_FILE_BYTES = 64 * 1024;

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { out.push({ rel: path.relative(base, full).split(path.sep).join('/'), symlink: true }); continue; }
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push({ rel: path.relative(base, full).split(path.sep).join('/'), full, size: fs.statSync(full).size });
  }
  return out;
}

function readMeta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
}

const isNodeArgv = (argv) => Array.isArray(argv) && argv.length >= 3 && argv[0] === 'node' && argv.every((a) => typeof a === 'string' && a.length > 0);
const testFiles = (argv) => (Array.isArray(argv) ? argv.slice(1).filter((a) => !a.startsWith('-')) : []);

// Returns a list of human-readable problems; empty means the task directory is well formed.
function validateTaskDir(dir) {
  const problems = [];
  const name = path.basename(dir);
  const parent = path.basename(path.dirname(dir));
  const exists = (rel) => fs.existsSync(path.join(dir, rel));
  let meta;
  try { meta = readMeta(dir); } catch (error) { return [`meta.json: ${error.message}`]; }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return ['meta.json must be an object'];
  for (const key of Object.keys(meta)) if (!META_FIELDS.includes(key)) problems.push(`meta.json: unknown field "${key}"`);
  if (!isId(meta.id)) problems.push('meta.id must be an identifier');
  else if (meta.id !== name) problems.push(`meta.id "${meta.id}" must equal the directory name "${name}"`);
  if (typeof meta.title !== 'string' || !meta.title) problems.push('meta.title must be a non-empty string');
  if (!SPLITS.includes(meta.split)) problems.push(`meta.split must be one of ${SPLITS.join(', ')}`);
  else if (SPLITS.includes(parent) && parent !== meta.split) problems.push(`meta.split "${meta.split}" does not match the directory "${parent}"`);
  else if (!SPLITS.includes(parent) && parent !== 'toy') problems.push(`task directory must live under a dev/, final/ or toy/ directory, not "${parent}"`);
  if (!CATEGORIES.includes(meta.category)) problems.push(`meta.category must be one of ${CATEGORIES.join(', ')}`);
  if (!DIFFICULTIES.includes(meta.difficulty)) problems.push(`meta.difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (typeof meta.pitfall !== 'string' || meta.pitfall.length < 10) problems.push('meta.pitfall must be a sentence');
  if (!Array.isArray(meta.outputs) || meta.outputs.length === 0 || !meta.outputs.every(isArtifactName) || new Set(meta.outputs).size !== meta.outputs.length) {
    problems.push('meta.outputs must be a non-empty array of unique artifact names (flat file names)');
  }
  if (!['pass', 'fail'].includes(meta.visible_on_start)) problems.push('meta.visible_on_start must be "pass" or "fail"');
  if (!isNodeArgv(meta.visible_test_argv)) problems.push('meta.visible_test_argv must be a node argv with at least one test file');
  for (const key of ['gate_test_argv', 'audit_test_argv']) {
    if (!isNodeArgv(meta[key]) || !meta[key].includes('--test') || !meta[key].includes('--test-reporter=tap')) problems.push(`meta.${key} must be a node argv using --test and --test-reporter=tap`);
  }
  if (typeof meta.naive !== 'boolean') problems.push('meta.naive must be a boolean');

  if (!exists('prompt.md') || fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8').trim().length < 20) problems.push('prompt.md is missing or too short');
  for (const sub of ['repo', 'hidden/gate', 'hidden/audit', 'reference']) if (!exists(sub)) problems.push(`${sub}/ is missing`);
  if (meta.naive === true && !exists('naive')) problems.push('meta.naive is true but naive/ is missing');
  if (meta.naive === false && exists('naive')) problems.push('naive/ exists but meta.naive is false');
  if (problems.length) return problems;

  const sets = {};
  for (const sub of ['repo', 'hidden/gate', 'hidden/audit', 'reference', ...(meta.naive ? ['naive'] : [])]) {
    const files = walkFiles(path.join(dir, sub));
    sets[sub] = files;
    if (files.length === 0) problems.push(`${sub}/ is empty`);
    for (const f of files) {
      if (f.symlink) problems.push(`${sub}/${f.rel} is a symbolic link`);
      else if (f.size > MAX_FILE_BYTES) problems.push(`${sub}/${f.rel} is larger than ${MAX_FILE_BYTES} bytes`);
    }
  }
  for (const s of fs.readdirSync(path.join(dir, 'hidden')).filter((e) => e !== 'gate' && e !== 'audit')) problems.push(`hidden/${s} is not under hidden/gate or hidden/audit`);
  const names = (sub) => new Set(sets[sub].map((f) => f.rel));
  const repo = names('repo');
  const gate = names('hidden/gate');
  const audit = names('hidden/audit');
  for (const out of meta.outputs || []) {
    if (!repo.has(out)) problems.push(`output ${out} is not in repo/`);
    for (const sub of ['reference', ...(meta.naive ? ['naive'] : [])]) if (!names(sub).has(out)) problems.push(`output ${out} is not in ${sub}/`);
  }
  for (const sub of ['reference', ...(meta.naive ? ['naive'] : [])]) {
    for (const f of names(sub)) if (!(meta.outputs || []).includes(f)) problems.push(`${sub}/${f} is not a declared output`);
  }
  for (const h of [...gate, ...audit]) if (repo.has(h)) problems.push(`hidden file ${h} would overwrite repo/${h}`);
  for (const h of gate) if (audit.has(h)) problems.push(`${h} is in both hidden/gate and hidden/audit`);
  const auditFiles = testFiles(meta.audit_test_argv);
  for (const f of testFiles(meta.visible_test_argv)) if (!repo.has(f)) problems.push(`visible_test_argv names ${f}, which is not in repo/`);
  for (const f of testFiles(meta.gate_test_argv)) if (!gate.has(f)) problems.push(`gate_test_argv names ${f}, which is not in hidden/gate/`);
  for (const f of auditFiles) if (!gate.has(f) && !audit.has(f)) problems.push(`audit_test_argv names ${f}, which is in neither hidden/gate/ nor hidden/audit/`);
  for (const f of testFiles(meta.gate_test_argv)) if (!auditFiles.includes(f)) problems.push(`gate file ${f} is not run by the audit (the audit must be a superset)`);
  for (const f of audit) if (!auditFiles.includes(f)) problems.push(`audit_test_argv must include the audit file ${f}`);
  const prompt = fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8');
  for (const h of [...gate, ...audit]) if (prompt.includes(h)) problems.push(`prompt.md mentions the hidden file ${h}`);
  return problems;
}

function loadTask(dir) {
  const abs = path.resolve(dir);
  const problems = validateTaskDir(abs);
  if (problems.length) throw new Error(`invalid agent task ${abs}: ${problems.join('; ')}`);
  const meta = readMeta(abs);
  return Object.freeze({
    id: meta.id, title: meta.title, split: meta.split, dir: abs, meta,
    prompt: fs.readFileSync(path.join(abs, 'prompt.md'), 'utf8'),
    repoDir: path.join(abs, 'repo'), gateDir: path.join(abs, 'hidden', 'gate'), auditDir: path.join(abs, 'hidden', 'audit'),
    referenceDir: path.join(abs, 'reference'), naiveDir: meta.naive ? path.join(abs, 'naive') : null,
  });
}

function listTaskDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, e.name)).sort();
}

const BENCH_ROOT = path.resolve(__dirname, '..', '..', 'bench', 'agent-claims');

/** Task directories of one split ("dev" | "final" | "toy"), sorted by id. */
function listSplit(split, benchRoot = BENCH_ROOT) {
  if (!SPLITS.includes(split)) throw new Error(`unknown split "${split}"`);
  const root = split === 'toy' ? path.join(benchRoot, 'toy') : path.join(benchRoot, 'tasks', split);
  return fs.existsSync(root) ? listTaskDirs(root) : [];
}

/**
 * A warrant run spec that has one agent task per benchmark task. The only requirement is the hidden-test gate:
 * a `command` verifier that runs scripts/agent-gate.js, which re-assembles a fresh directory (pristine repo + the
 * agent's declared outputs + gate tests) and runs the gate tests in the sandbox.
 */
function buildAgentRunSpec({ runId, tasks, gateScript, deadlineMs = 300_000, gateTimeoutMs = 120_000, maxAttempts = 1, maxConcurrency = 1 }) {
  return {
    spec_version: '1',
    run_id: runId,
    max_concurrency: maxConcurrency,
    tasks: tasks.map((task) => ({
      id: task.id, deps: [], effect: 'pure', deadline_ms: deadlineMs, max_attempts: maxAttempts,
      outputs: [...task.meta.outputs],
      requirements: [{ id: 'hidden-tests', kind: 'command', argv: ['node', gateScript, task.dir], timeout_ms: gateTimeoutMs }],
    })),
  };
}

module.exports = Object.freeze({ BENCH_ROOT, CATEGORIES, DIFFICULTIES, MAX_FILE_BYTES, SPLITS, buildAgentRunSpec, listSplit, listTaskDirs, loadTask, testFiles, validateTaskDir, walkFiles });
