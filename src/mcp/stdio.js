'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LineSplitter } = require('./jsonrpc');
const { LIMITS } = require('./limits');
const { McpServer } = require('./server');
const { RunManager } = require('./runs');
const { SpecStore } = require('./specs');
const { createTools } = require('./tools');

// The version is informational; a missing or unreadable package.json must not stop the server from starting.
function packageVersion() {
  try { return String(require('../../package.json').version); } catch (_error) { return '0.0.0'; }
}

const SERVER_INFO = Object.freeze({
  name: 'warrant-mcp',
  title: 'Warrant: evidence-gated runs of approved specs',
  version: packageVersion(),
});

// Real path of a path that may not exist yet: the nearest existing ancestor is resolved, the rest is appended.
function realish(p) {
  try { return fs.realpathSync(p); } catch (error) {
    const parent = path.dirname(p);
    if (error.code !== 'ENOENT' || parent === p) throw error;
    return path.join(realish(parent), path.basename(p));
  }
}

function contains(outer, inner) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const o = norm(outer);
  const i = norm(inner);
  return i === o || i.startsWith(o.endsWith(path.sep) ? o : o + path.sep);
}

// Builds the server for a spec directory and a state directory. Throws on a bad directory so the human sees it at startup,
// before anything is created or read.
function createServer({ specDir, stateDir, maxRunMs, syncWaitMs, write, log }) {
  const specs = new SpecStore(specDir);
  const state = realish(path.resolve(stateDir));
  if (contains(specs.dir, state) || contains(state, specs.dir)) {
    throw new Error('--state-dir and --spec-dir must not be the same directory or contain one another');
  }
  const runs = new RunManager({ specs, stateDir: state, maxRunMs, syncWaitMs, log });
  const server = new McpServer({ tools: createTools({ specs, runs }), serverInfo: SERVER_INFO, write, log, onClose: () => runs.shutdown() });
  return { server, runs, specs };
}

// Newline-delimited JSON-RPC over a pair of streams. `done` resolves when input ends (or shutdown() is called) and the
// active run, if any, is gone.
// Nothing but protocol messages is ever written to `output`; diagnostics go to `errors`.
function serveStdio({ input = process.stdin, output = process.stdout, errors = process.stderr, ...options }) {
  let paused = false; // output backpressure: while the client is not reading, the server stops reading requests
  const write = (message) => {
    if (output.destroyed) return;
    const line = JSON.stringify(message).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    if (output.write(`${line}\n`) === false && !paused) {
      paused = true;
      input.pause();
      output.once('drain', () => { paused = false; input.resume(); });
    }
  };
  const log = (text) => { try { errors.write(`warrant-mcp: ${text}\n`); } catch (_error) { /* stderr is optional */ } };
  const { server } = createServer({ ...options, write, log }); // throws on a bad directory, before any input is read
  let shutdown;
  const done = new Promise((resolve) => {
    const pending = new Set();
    let finished = false;
    const splitter = new LineSplitter(LIMITS.maxRequestBytes);

    const handle = (items) => {
      for (const item of items) {
        if (item.oversize) { server.oversize(); continue; }
        if (!item.line.trim()) continue;
        const p = server.handleLine(item.line).catch((error) => log(`unhandled: ${error && error.stack ? error.stack : error}`)).finally(() => pending.delete(p));
        pending.add(p);
      }
    };
    shutdown = async () => {
      if (finished) return;
      finished = true;
      handle(splitter.end());
      try { await server.close(); } catch (error) { log(`shutdown error: ${error && error.message}`); }
      await Promise.allSettled([...pending]);
      resolve();
    };
    input.on('data', (chunk) => handle(splitter.push(chunk)));
    input.on('end', shutdown);
    input.on('close', shutdown);
    input.on('error', shutdown);
    output.on('error', shutdown); // the client went away
  });
  return { done, shutdown: () => shutdown() };
}

module.exports = Object.freeze({ SERVER_INFO, createServer, serveStdio });
