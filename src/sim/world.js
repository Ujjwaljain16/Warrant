'use strict';

const { correctContent, wrongContent } = require('./truth');

const TOKENS_PER_MS = 10;

// Ground-truth ledger of what the simulated outside world actually experienced, independent of what any
// orchestrator believes. Metrics are computed from this, never from an orchestrator's own report.
class World {
  constructor(tasks) {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
    this.effects = new Map(tasks.map((t) => [t.id, { count: 0, times: [], keys: new Set(), lastOutput: null }]));
    this.crashes = new Map(tasks.map((t) => [t.id, 0]));
    this.open = new Map();
    this.workMs = 0;
    this.attemptsStarted = 0;
  }

  startAttempt(attemptId, t) {
    this.attemptsStarted++;
    this.open.set(attemptId, t);
  }

  endAttempt(attemptId, t) {
    if (!this.open.has(attemptId)) return;
    this.workMs += Math.max(0, t - this.open.get(attemptId));
    this.open.delete(attemptId);
  }

  noteCrash(taskId) {
    this.crashes.set(taskId, this.crashes.get(taskId) + 1);
  }

  // Charge attempts that never finished (hangs under a policy with no deadline) up to the end of the run.
  closeAll(t) {
    for (const id of [...this.open.keys()]) this.endAttempt(id, t);
  }

  get tokens() {
    return this.workMs * TOKENS_PER_MS;
  }

  // The real-world side effect of a task. `output` is what the effect produced.
  applyEffect(taskId, key, t, output) {
    const rec = this.effects.get(taskId);
    const effect = this.tasks.get(taskId).effect;
    // An external-idempotent effect with an already-applied key is a no-op in the outside world.
    if (effect === 'external-idempotent' && rec.keys.has(key)) return false;
    rec.keys.add(key);
    rec.count++;
    rec.times.push(t);
    rec.lastOutput = output;
    return true;
  }

  produce(taskId, inputs, kind, attemptNo) {
    return kind === 'false_claim' ? wrongContent(taskId, inputs, attemptNo) : correctContent(taskId, inputs);
  }

  effectCount(taskId) {
    return this.effects.get(taskId).count;
  }

  lastOutput(taskId) {
    return this.effects.get(taskId).lastOutput;
  }
}

module.exports = Object.freeze({ TOKENS_PER_MS, World });
