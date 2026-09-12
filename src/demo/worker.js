'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AgentWorker } = require('../agent');
const { writeGateLauncher } = require('./materialize');

/**
 * Lets work run in parallel but hands results to the engine in a fixed order: a task's delivery is released only
 * once every task before it (in `order`) has settled. Real time then cannot reorder the run log, which is what makes
 * two replays byte-identical. It changes nothing about what is accepted, only when an already-finished result is
 * presented. A task not in `order` (the integrate task) is never held.
 */
class Turnstile {
  constructor(order) {
    this.order = [...order];
    this.settled = new Set();
    this.waiters = [];
  }

  settle(id) {
    this.settled.add(id);
    for (const waiter of [...this.waiters]) if (this._open(waiter.id)) { this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.release(); }
  }

  _open(id) {
    const index = this.order.indexOf(id);
    return index < 0 || this.order.slice(0, index).every((earlier) => this.settled.has(earlier));
  }

  wait(id, signal) {
    if (this._open(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = { id, release: resolve };
      this.waiters.push(waiter);
      if (signal) {
        signal.addEventListener('abort', () => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          resolve();
        }, { once: true });
      }
    });
  }
}

/**
 * The warrant Worker for the demo. Bug tasks are handed to the phase-1 AgentWorker unchanged (Docker sandbox, strict
 * JSON protocol, confined workspace). The `integrate` task is done by the host itself: it merges the artifacts of the
 * attempts the engine accepted for its dependencies (and the pristine file for anything that was not planned) into a
 * workspace and claims success; the hidden integration suite, not that claim, decides.
 *
 * `gateScript` set: a launcher `gate.js` naming the task's hidden-test directory is written into every attempt
 * directory first (gated mode). `delivered` keeps, per attempt, the artifacts exactly as the worker delivered them.
 */
class DemoWorker {
  constructor({ baseDir, llm, model, tasks, integrate, catalogue, gateScript = null, taskDirs = new Map(), loop = {}, sandbox, order }) {
    const agentOptions = { baseDir, llm, model, tasks: Object.fromEntries(tasks), loop };
    if (sandbox) agentOptions.sandbox = sandbox;
    this.agent = new AgentWorker(agentOptions);
    this.integrate = integrate;
    this.catalogue = catalogue;
    this.gateScript = gateScript;
    this.taskDirs = taskDirs;
    this.turnstile = new Turnstile(order || [...tasks.keys()]);
    this.delivered = new Map();
    this.observer = (event) => { if (event && event.type === 'settled') this.turnstile.settle(event.task); };
  }

  get results() { return this.agent.results; }

  workDirFor(info) { return this.agent.workDirFor(info); }

  async execute(info, ctx) {
    const dir = this.agent.attemptDir(info.runId, info.attemptId);
    fs.mkdirSync(dir, { recursive: true });
    if (this.gateScript) writeGateLauncher(dir, this.taskDirs.get(info.taskId), this.gateScript);
    const pending = [];
    const held = {
      ...ctx,
      deliver: (envelope) => {
        if (envelope && envelope.claim === 'success' && envelope.artifacts) this.delivered.set(info.attemptId, { ...envelope.artifacts });
        pending.push(this.turnstile.wait(info.taskId, ctx.signal).then(() => ctx.deliver(envelope)));
      },
    };
    if (info.taskId === this.integrate.id) this._mergeAndClaim(info, dir, held);
    else await this.agent.execute(info, held);
    await Promise.all(pending);
  }

  _mergeAndClaim(info, dir, ctx) {
    const artifacts = this.mergeFor(info.depAttempts || {});
    const workspace = path.join(dir, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    for (const [name, body] of Object.entries(artifacts)) fs.writeFileSync(path.join(workspace, name), body);
    ctx.deliver({ attemptId: info.attemptId, claim: 'success', artifacts });
  }

  // pristine files for every output, overlaid with what each accepted dependency attempt delivered
  mergeFor(depAttempts) {
    const merged = {};
    for (const name of this.integrate.meta.outputs) merged[name] = fs.readFileSync(path.join(this.catalogue.repoDir, name), 'utf8').replace(/\r\n/g, '\n');
    for (const attemptId of Object.values(depAttempts)) {
      const delivered = this.delivered.get(attemptId);
      if (!delivered) continue;
      for (const name of this.integrate.meta.outputs) if (Object.hasOwn(delivered, name)) merged[name] = delivered[name];
    }
    return merged;
  }
}

module.exports = Object.freeze({ DemoWorker, Turnstile });
