'use strict';

const { unit } = require('./rng');

const EFFECT_POINT = 0.45; // fraction of the latency at which the side effect lands

// Abortable virtual sleep: resolves true when the time elapses, false if the signal aborts first.
function sleep(clock, ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return; }
    let handle;
    const onAbort = () => { clock.clearTimeout(handle); resolve(false); };
    handle = clock.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Deterministic fake worker. Behaviour for each attempt comes from a fault plan (a pure function of
 * seed, task and attempt). It models *failure behaviour*, not intelligence: it always knows the correct
 * answer and deviates from it only when the plan says so.
 */
class FakeWorker {
  constructor({ world, plan, clock }) {
    this.world = world;
    this.plan = plan;
    this.clock = clock;
    if (!plan.reconcileAvailable) this.reconcile = undefined;
  }

  async execute(info, ctx) {
    const { world, clock } = this;
    const { taskId, attemptNo, attemptId, idempotencyKey, inputs } = info;
    const nominal = world.tasks.get(taskId).nominal_ms;
    const fate = this.plan.fate(taskId, attemptNo);
    world.startAttempt(attemptId, clock.now());
    ctx.signal.addEventListener('abort', () => world.endAttempt(attemptId, clock.now()), { once: true });
    const finish = () => world.endAttempt(attemptId, clock.now());

    if (fate.kind === 'permanent_failure') {
      if (!(await sleep(clock, Math.round(nominal * 0.3), ctx.signal))) return;
      finish();
      ctx.deliver({ attemptId, claim: 'failure', errorCode: 'PERMANENT', retryable: true });
      return;
    }
    if (fate.kind === 'crash_before') {
      if (!(await sleep(clock, Math.round(nominal * 0.3), ctx.signal))) return;
      finish();
      world.noteCrash(taskId);
      throw new Error('simulated worker crash before effect');
    }
    if (fate.kind === 'hang') {
      // Never produces a result. An abort (deadline or cancel) stops it, like killing a hung process; a policy
      // that never aborts leaves it hanging until the end of the run.
      await new Promise((resolve) => { ctx.signal.addEventListener('abort', resolve, { once: true }); });
      return;
    }

    const latency = Math.round(nominal * (fate.kind === 'delay' ? 6 : 1));
    if (!(await sleep(clock, Math.round(latency * EFFECT_POINT), ctx.signal))) return;
    const output = world.produce(taskId, inputs, fate.kind === 'false_claim' ? 'false_claim' : 'ok', attemptNo);
    world.applyEffect(taskId, idempotencyKey, clock.now(), output);

    if (fate.kind === 'crash_after') {
      if (!(await sleep(clock, Math.round(latency * 0.4), ctx.signal))) return;
      finish();
      world.noteCrash(taskId);
      throw new Error('simulated worker crash after effect');
    }
    if (!(await sleep(clock, latency - Math.round(latency * EFFECT_POINT), ctx.signal))) return;
    finish();

    let envelope;
    if (fate.kind === 'invalid') {
      envelope = unit(`${attemptId}|invalid-variant`) < 0.5
        ? { attemptId, claim: 'success', artifacts: {} }
        : { attemptId, claim: 'success', artifacts: 'garbage' };
    } else {
      envelope = { attemptId, claim: 'success', artifacts: { out: output } };
    }
    ctx.deliver(envelope);
    if (fate.duplicate) clock.setTimeout(() => ctx.deliver(envelope), 1);
  }

  async reconcile(info, ctx) {
    if (!(await sleep(this.clock, 5, ctx.signal))) throw new Error('reconcile aborted');
    const count = this.world.effectCount(info.taskId);
    return count > 0 ? { applied: true, artifacts: { out: this.world.lastOutput(info.taskId) } } : { applied: false };
  }
}

module.exports = Object.freeze({ EFFECT_POINT, FakeWorker, sleep });
