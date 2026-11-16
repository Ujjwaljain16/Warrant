'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Engine, resumeGated } = require('../engine/engine');
const { auditLog } = require('../engine/replay');
const { FileRunLog, LogCorruptionError, LogLockedError, readRunLogFile } = require('../log/runlog');
const { SpecError, assertRunSpec, validateRunSpec } = require('../core/spec');
const { ReceiptWorker } = require('../workers/receipt-worker');
const { ResumeError } = require('../engine/replay');
const { formatRunReport, formatVerifyReport } = require('./format');
const { SigningError, generateKeyPair, loadPrivateKey, loadPublicKey, sigFileFor, signHead, verifyHead } = require('../log/signing');

const USAGE = `warrant - evidence-gated execution of bounded work

usage:
  warrant validate <spec.json>
  warrant run <spec.json> [--dir <workdir>] [--log <file>] [--concurrency <n>] [--sign-key <key>] [--format json|text]
  warrant resume <spec.json> --log <file> [--dir <workdir>] [--concurrency <n>] [--sign-key <key>] [--format json|text]
  warrant verify-log <log> [--spec <spec.json>] [--pubkey <key.pub> [--sig <file>]] [--format json|text]
  warrant keygen [--out <dir>]                       write an Ed25519 key pair for signing logs
  warrant sign-log <log> --key <key> [--sig <file>]  sign a finished log's head (written to <log>.sig)
  warrant bench [--seeds <dev|final|partial-requirements>] [--out <dir>] [--workloads <ids>] [--profiles <ids>]
  warrant report <results-dir>

exit codes: 0 success / consistent, 1 run did not succeed / log inconsistent, 2 usage or input error`;

const VALUE_FLAGS = new Set(['--dir', '--log', '--concurrency', '--spec', '--seeds', '--out', '--workloads', '--profiles', '--format', '--sign-key', '--key', '--pubkey', '--sig']);

// A path under the working directory is shown relative to it, anything else in full.
function shown(cwd, file) {
  const rel = path.relative(cwd, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel;
}

function formatOption(flags) {
  const format = flags['--format'] || 'json';
  if (format !== 'json' && format !== 'text') throw new UsageError('--format must be json or text');
  return format;
}

function logFileFor(spec, flags, cwd) {
  const workDir = path.resolve(cwd, flags['--dir'] || '.warrant');
  return path.resolve(cwd, flags['--log'] || path.join(workDir, spec.run_id, 'run.log'));
}

// Signs the head of a finished log and writes the record next to it (or to --sig). Returns the record.
function signLogFile(logFile, privateKey, sigFile) {
  const { entries } = readRunLogFile(logFile);
  const record = signHead(entries, privateKey);
  fs.writeFileSync(sigFile || sigFileFor(logFile), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

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
  const logFile = logFileFor(spec, flags, io.cwd);
  // One log holds one run: a second `run` appended to an old log would leave it with two run_started entries, which verify-log rejects.
  if (kind === 'run' && fs.existsSync(logFile) && fs.statSync(logFile).size > 0) {
    throw new UsageError(`a run log already exists at ${logFile}; continue it with "warrant resume", or choose another --dir or --log`);
  }
  const worker = new ReceiptWorker({ baseDir: path.join(workDir, 'attempts'), specDir: path.dirname(specFile) });
  const log = new FileRunLog(logFile);
  const opts = { worker, log, workDirFor: (a) => worker.workDirFor(a), specDir: path.dirname(specFile), concurrency: concurrencyOption(flags) };
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

// Colour only for a real terminal that did not opt out (https://no-color.org); tests pass their own writer and get plain text.
function colorFor(io) {
  return !io.stdout && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
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
      const format = formatOption(flags);
      const specFile = path.resolve(cwd, rest[0]);
      const spec = assertRunSpec(readJson(specFile));
      const signKey = flags['--sign-key'] ? loadPrivateKey(path.resolve(cwd, flags['--sign-key'])) : null; // fail before the run, not after
      const report = await execute(command, spec, flags, ctx, specFile);
      if (signKey) {
        const logFile = logFileFor(spec, flags, cwd);
        const record = signLogFile(logFile, signKey);
        report.signature = { file: path.relative(cwd, sigFileFor(logFile)), key_id: record.key_id, head: record.head };
      }
      out(format === 'text' ? formatRunReport(report, { color: colorFor(io) }) : `${JSON.stringify(report, null, 2)}\n`);
      return report.status === 'succeeded' ? 0 : 1;
    }

    if (command === 'verify-log') {
      if (rest.length !== 1) throw new UsageError('verify-log takes exactly one log file');
      const file = path.resolve(cwd, rest[0]);
      if (!fs.existsSync(file)) throw new UsageError(`no such log: ${rest[0]}`);
      const format = formatOption(flags);
      if (flags['--sig'] && !flags['--pubkey']) throw new UsageError('--sig needs --pubkey <key.pub> to check the signature with');
      const loaded = readRunLogFile(file);
      let violations = [];
      if (flags['--spec']) violations = auditLog(assertRunSpec(readJson(path.resolve(cwd, flags['--spec']))), loaded.entries);
      const result = { entries: loaded.entries.length, head: loaded.head, torn_tail: loaded.torn, invariants_checked: Boolean(flags['--spec']), violations };
      if (flags['--pubkey']) {
        const publicKey = loadPublicKey(path.resolve(cwd, flags['--pubkey']));
        const sigFile = flags['--sig'] ? path.resolve(cwd, flags['--sig']) : sigFileFor(file);
        if (!fs.existsSync(sigFile)) result.signature = { valid: false, reason: `no signature file at ${path.relative(cwd, sigFile)}` };
        else {
          let record = null;
          try { record = JSON.parse(fs.readFileSync(sigFile, 'utf8')); } catch (_error) { record = null; }
          result.signature = verifyHead(loaded.entries, record, publicKey);
        }
      }
      out(format === 'text' ? formatVerifyReport(result, { color: colorFor(io) }) : `${JSON.stringify(result, null, 2)}\n`);
      return violations.length || (result.signature && !result.signature.valid) ? 1 : 0;
    }

    if (command === 'keygen') {
      if (rest.length) throw new UsageError('keygen takes no positional arguments');
      const made = generateKeyPair(path.resolve(cwd, flags['--out'] || '.warrant-keys'));
      out(`${JSON.stringify({ private_key: shown(cwd, made.privateKeyFile), public_key: shown(cwd, made.publicKeyFile), key_id: made.keyId, note: 'keep the private key out of version control; share the public key' }, null, 2)}\n`);
      return 0;
    }

    if (command === 'sign-log') {
      if (rest.length !== 1) throw new UsageError('sign-log takes exactly one log file');
      if (!flags['--key']) throw new UsageError('sign-log requires --key <private key file>');
      const file = path.resolve(cwd, rest[0]);
      if (!fs.existsSync(file)) throw new UsageError(`no such log: ${rest[0]}`);
      const sigFile = flags['--sig'] ? path.resolve(cwd, flags['--sig']) : sigFileFor(file);
      const record = signLogFile(file, loadPrivateKey(path.resolve(cwd, flags['--key'])), sigFile);
      out(`${JSON.stringify({ signature_file: path.relative(cwd, sigFile), key_id: record.key_id, entries: record.entries, head: record.head }, null, 2)}\n`);
      return 0;
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
    if (error instanceof SigningError) { err(`error: ${error.message}\n`); return 2; }
    err(`error: ${error.message}\n`);
    return 1;
  }
}

module.exports = Object.freeze({ USAGE, main, parseArgs });
