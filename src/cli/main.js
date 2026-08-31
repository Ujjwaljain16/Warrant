'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Engine, resumeGated } = require('../engine/engine');
const { auditLog } = require('../engine/replay');
const { FileRunLog, LogCorruptionError, LogLockedError, readRunLogFile } = require('../log/runlog');
const { SpecError, assertRunSpec, validateRunSpec } = require('../core/spec');
const { ReceiptWorker } = require('../workers/receipt-worker');
const { ResumeError } = require('../engine/replay');

const USAGE = `warrant - evidence-gated execution of bounded work

usage:
  warrant validate <spec.json>
  warrant run <spec.json> [--dir <workdir>] [--log <file>] [--concurrency <n>]
  warrant resume <spec.json> --log <file> [--dir <workdir>] [--concurrency <n>]
  warrant verify-log <log> [--spec <spec.json>]
  warrant bench [--seeds <final|dev>] [--out <dir>] [--workloads <ids>] [--profiles <ids>]
  warrant report <results-dir>

exit codes: 0 success / consistent, 1 run did not succeed / log inconsistent, 2 usage or input error`;

const VALUE_FLAGS = new Set(['--dir', '--log', '--concurrency', '--spec', '--seeds', '--out', '--workloads', '--profiles']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (!VALUE_FLAGS.has(arg)) throw new UsageError(`unknown option ${arg}`);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`missing value for ${arg}`);
      if (Object.hasOwn(flags, arg)) throw new UsageError(`duplicate option ${arg}`);
      flags[arg] = argv[++i];
    } else positional.push(arg);
  }
  return { positional, flags };
}

class UsageError extends Error {}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { throw new UsageError(`cannot read ${file}: ${error.code || error.message}`); }
  try { return JSON.parse(text); } catch (_error) { throw new UsageError(`${file} is not valid JSON`); }
}

function concurrencyOption(flags) {
  if (!Object.hasOwn(flags, '--concurrency')) return undefined;
  const n = Number(flags['--concurrency']);
  if (!Number.isInteger(n) || n < 1) throw new UsageError('--concurrency must be a positive integer');
  return n;
}

async function execute(kind, spec, flags, io, specFile) {
  const workDir = path.resolve(io.cwd, flags['--dir'] || '.warrant');
  const logFile = path.resolve(io.cwd, flags['--log'] || path.join(workDir, spec.run_id, 'run.log'));
  const worker = new ReceiptWorker({ baseDir: path.join(workDir, 'attempts'), specDir: path.dirname(specFile) });
  const log = new FileRunLog(logFile);
  const opts = { worker, log, workDirFor: (a) => worker.workDirFor(a), concurrency: concurrencyOption(flags) };
  let engine;
  let onSigint;
  try {
    if (kind === 'resume') {
      // resumeGated builds its own Engine; cancellation on SIGINT is wired through an AbortController.
      const controller = new AbortController();
      onSigint = () => controller.abort();
      process.once('SIGINT', onSigint);
      return await resumeGated(spec, { ...opts, signal: controller.signal });
    }
    engine = new Engine(spec, opts);
    onSigint = () => engine.cancel('SIGINT');
    process.once('SIGINT', onSigint);
    return await engine.run();
  } finally {
    if (onSigint) process.removeListener('SIGINT', onSigint);
    log.close();
  }
}

async function main(argv, io = {}) {
  const out = io.stdout || ((s) => process.stdout.write(s));
  const err = io.stderr || ((s) => process.stderr.write(s));
  const cwd = io.cwd || process.cwd();
  const ctx = { cwd, stdout: out, stderr: err };
  try {
    const { positional, flags } = parseArgs(argv);
    const [command, ...rest] = positional;
    if (!command || command === 'help') { out(`${USAGE}\n`); return command ? 0 : 2; }

    if (command === 'validate') {
      if (rest.length !== 1) throw new UsageError('validate takes exactly one spec file');
      const result = validateRunSpec(readJson(path.resolve(cwd, rest[0])));
      out(`${JSON.stringify(result.ok ? { ok: true, tasks: result.spec.tasks.length } : { ok: false, errors: result.errors }, null, 2)}\n`);
      return result.ok ? 0 : 2;
    }

    if (command === 'run' || command === 'resume') {
      if (rest.length !== 1) throw new UsageError(`${command} takes exactly one spec file`);
      if (command === 'resume' && !flags['--log']) throw new UsageError('resume requires --log <file>');
      const specFile = path.resolve(cwd, rest[0]);
      const spec = assertRunSpec(readJson(specFile));
      const report = await execute(command, spec, flags, ctx, specFile);
      out(`${JSON.stringify(report, null, 2)}\n`);
      return report.status === 'succeeded' ? 0 : 1;
    }

    if (command === 'verify-log') {
      if (rest.length !== 1) throw new UsageError('verify-log takes exactly one log file');
      const file = path.resolve(cwd, rest[0]);
      if (!fs.existsSync(file)) throw new UsageError(`no such log: ${rest[0]}`);
      const loaded = readRunLogFile(file);
      let violations = [];
      if (flags['--spec']) violations = auditLog(assertRunSpec(readJson(path.resolve(cwd, flags['--spec']))), loaded.entries);
      out(`${JSON.stringify({ entries: loaded.entries.length, head: loaded.head, torn_tail: loaded.torn, invariants_checked: Boolean(flags['--spec']), violations }, null, 2)}\n`);
      return violations.length ? 1 : 0;
    }

    if (command === 'bench' || command === 'report') {
      const bench = require('../bench/cli');
      return await bench.run(command, rest, flags, ctx);
    }

    throw new UsageError(`unknown command "${command}"`);
  } catch (error) {
    if (error instanceof UsageError) { err(`error: ${error.message}\n\n${USAGE}\n`); return 2; }
    if (error instanceof SpecError) { err(`error: ${error.message}\n`); return 2; }
    if (error instanceof LogCorruptionError) { err(`error: run log is corrupt (${error.code}): ${error.message}\n`); return 1; }
    if (error instanceof LogLockedError) { err(`error: ${error.message}; if that process is gone, pass a fresh --log or remove the .lock file\n`); return 2; }
    if (error instanceof ResumeError) { err(`error: cannot resume (${error.code}): ${error.message}\n`); return 2; }
    err(`error: ${error.message}\n`);
    return 1;
  }
}

module.exports = Object.freeze({ USAGE, main, parseArgs });
