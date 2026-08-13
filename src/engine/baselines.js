'use strict';

// Comparison policies for the benchmark (docs/EVALUATION_PROTOCOL.md). They are deliberately the simplest
// credible alternatives, not strawmen: both validate that a result envelope is structurally sound (the same
// parser the gated engine uses) and retry failures up to the same attempt budget. What they do NOT have is
// what the gated engine adds: content verification, deadlines, effect-class recovery, per-attempt result
// deduplication, and cancellation that reaches in-flight work.

const { assertRunSpec, topologicalOrder } = require('../core/spec');
const { digestArtifacts } = require('../core/gate');
const { parseEnvelope, declaredArtifacts } = require('./envelope');

const noop = () => {};

// Interpret one worker outcome the way a trusting orchestrator does: structurally valid success => done.
function interpret(task, attemptId, raw) {
  const parsed = parseEnvelope(raw, attemptId);
  if (!parsed.ok) return { kind: 'retry', code: parsed.code };
  if (parsed.claim === 'failure') return { kind: parsed.retryable ? 'retry' : 'fail', code: parsed.errorCode };
  const artifacts = declaredArtifacts(task, parsed.artifacts);
  if (!task.outputs.every((n) => Object.hasOwn(artifacts, n))) return { kind: 'retry', code: 'MISSING_OUTPUT' };
  return { kind: 'success', digest: digestArtifacts(artifacts) };
}

function makeReport(spec, statuses, attempts, digests, codes, incomplete) {
  const tasks = {};
  const counts = {};
  for (const t of spec.tasks) {
    const status = statuses.get(t.id);
    counts[status] = (counts[status] || 0) + 1;
    tasks[t.id] = { status, attempts: attempts.get(t.id), code: codes.get(t.id) || null, artifacts_digest: status === 'succeeded' ? digests.get(t.id) : null };
  }
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);
  let status = 'succeeded';
  if (counts.cancelled) status = 'cancelled';
  else if (counts.failed) status = 'failed';
  else if (counts.unknown) status = 'unknown';
  else if (counts.blocked) status = 'blocked';
  return { run_id: spec.run_id, status: counts.succeeded === total ? 'succeeded' : status, counts, tasks, attempts: [...attempts.values()].reduce((a, b) => a + b, 0), duplicates_ignored: 0, incomplete };
}

/**
 * sequential: one task at a time in a precomputed topological order. Because it moves on after the first
 * delivery of each attempt, a duplicated delivery is naturally harmless here.
 */
function startSequential(specInput, opts) {
  const spec = assertRunSpec(specInput);
  const { worker, clock, observer = noop, runCapMs = Infinity } = opts;
  const byId = new Map(spec.tasks.map((t) => [t.id, t]));
  const statuses = new Map(spec.tasks.map((t) => [t.id, 'pending']));
  const attempts = new Map(spec.tasks.map((t) => [t.id, 0]));
  const digests = new Map();
  const codes = new Map();
  let cancelled = false;
  let capped = false;
  let capResolve;
  const capPromise = new Promise((resolve) => { capResolve = resolve; });
  const capTimer = Number.isFinite(runCapMs) ? clock.setTimeout(() => { capped = true; capResolve('cap'); }, runCapMs) : null;

  async function attemptOnce(task, no) {
    const attemptId = `${task.id}.${no}`;
    attempts.set(task.id, no);
    observer({ type: 'dispatch', t: clock.now(), task: task.id, attempt: no, deps_ok: task.deps.every((d) => statuses.get(d) === 'succeeded'), inflight: 1 });
    const inputs = Object.fromEntries(task.deps.map((d) => [d, digests.get(d)]));
    const never = new AbortController();
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; resolve(v); } };
      const info = { runId: spec.run_id, taskId: task.id, attemptNo: no, attemptId, idempotencyKey: `${spec.run_id}:${task.id}`, inputs, depAttempts: {}, task: { id: task.id, effect: task.effect, outputs: task.outputs, exec: task.exec, deadline_ms: task.deadline_ms } };
      const ctx = { signal: never.signal, clock, deliver: (raw) => settle({ kind: 'envelope', raw }) };
      let started;
      try { started = worker.execute(info, ctx); } catch (error) { started = Promise.reject(error); }
      Promise.resolve(started).catch(() => settle({ kind: 'crash' }));
      capPromise.then(() => settle({ kind: 'cap' }));
    });
  }

  const promise = (async () => {
    for (const id of topologicalOrder(spec.tasks)) {
      const task = byId.get(id);
      if (capped) break;
      if (cancelled) { statuses.set(id, 'cancelled'); continue; }
      if (!task.deps.every((d) => statuses.get(d) === 'succeeded')) { statuses.set(id, 'blocked'); continue; }
      statuses.set(id, 'running');
      let finalStatus = 'failed';
      for (let no = 1; no <= task.max_attempts; no++) {
        const outcome = await attemptOnce(task, no);
        if (outcome.kind === 'cap') { finalStatus = 'unknown'; break; }
        const verdict = outcome.kind === 'crash' ? { kind: 'retry', code: 'WORKER_CRASH' } : interpret(task, `${task.id}.${no}`, outcome.raw);
        if (verdict.kind === 'success') { digests.set(id, verdict.digest); finalStatus = 'succeeded'; break; }
        codes.set(id, verdict.code);
        if (verdict.kind === 'fail') break;
      }
      statuses.set(id, finalStatus);
      observer({ type: 'settled', t: clock.now(), task: id, status: finalStatus });
      if (finalStatus === 'unknown') break;
    }
    if (capTimer) clock.clearTimeout(capTimer);
    for (const [id, s] of statuses) if (s === 'pending' || s === 'running') statuses.set(id, capped ? 'unknown' : cancelled ? 'cancelled' : 'blocked');
    return makeReport(spec, statuses, attempts, digests, codes, capped);
  })();

  return { promise, cancel: () => { cancelled = true; } };
}

/**
 * naive-parallel: up to `max_concurrency` tasks at once, driven by the classic dependency-counter scheme.
 * Every completion *message* decrements its children's counters and frees a slot; no per-attempt
 * deduplication, no content check. With `deadlines: true` (the naive-parallel-timeout variant) each attempt also
 * gets the task's deadline: on expiry the worker is aborted and the attempt is retried, and any late delivery from
 * the timed-out attempt is ignored. Still no reconcile, no dedup of repeated deliveries, no content check.
 */
function startNaiveParallel(specInput, opts) {
  const spec = assertRunSpec(specInput);
  const { worker, clock, observer = noop, runCapMs = Infinity } = opts;
  const cap = Math.min(spec.max_concurrency, opts.concurrency ?? Infinity);
  const deadlines = Boolean(opts.deadlines);
  const byId = new Map(spec.tasks.map((t) => [t.id, t]));
  const children = new Map(spec.tasks.map((t) => [t.id, []]));
  for (const t of spec.tasks) for (const d of t.deps) children.get(d).push(t.id);
  const remaining = new Map(spec.tasks.map((t) => [t.id, t.deps.length]));
  const statuses = new Map(spec.tasks.map((t) => [t.id, 'pending']));
  const attempts = new Map(spec.tasks.map((t) => [t.id, 0]));
  const digests = new Map();
  const codes = new Map();
  const queue = spec.tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  let running = 0;
  let cancelled = false;
  let capped = false;
  let finished = false;
  let resolveRun;
  const promise = new Promise((resolve) => { resolveRun = resolve; });
  const capTimer = Number.isFinite(runCapMs) ? clock.setTimeout(() => { capped = true; finish(); }, runCapMs) : null;

  function finish() {
    if (finished) return;
    finished = true;
    if (capTimer) clock.clearTimeout(capTimer);
    for (const [id, s] of statuses) if (s === 'pending' || s === 'running') statuses.set(id, capped ? 'unknown' : cancelled ? 'cancelled' : 'blocked');
    resolveRun(makeReport(spec, statuses, attempts, digests, codes, capped));
  }

  function blockDescendants(id) {
    for (const c of children.get(id)) {
      if (statuses.get(c) === 'pending') { statuses.set(c, 'blocked'); blockDescendants(c); }
    }
  }

  function pump() {
    if (finished) return;
    while (!cancelled && running < cap && queue.length) {
      const id = queue.shift();
      if (statuses.get(id) !== 'pending') continue; // never start a task that is already running or done
      launch(byId.get(id), 1);
    }
    // Decide completion from real task statuses, not from the `running` counter (which duplicate deliveries corrupt).
    const anyRunning = [...statuses.values()].includes('running');
    if (!anyRunning && (cancelled || queue.length === 0)) finish();
  }

  function launch(task, no) {
    const id = task.id;
    statuses.set(id, 'running');
    attempts.set(id, no);
    running++;
    const attemptId = `${id}.${no}`;
    observer({ type: 'dispatch', t: clock.now(), task: id, attempt: no, deps_ok: task.deps.every((d) => statuses.get(d) === 'succeeded'), inflight: running });
    const inputs = Object.fromEntries(task.deps.map((d) => [d, digests.get(d)]));
    const controller = new AbortController();
    let timedOut = false;
    let timer = null;
    if (deadlines) {
      timer = clock.setTimeout(() => {
        if (finished) return;
        timedOut = true;
        controller.abort();
        onOutcome(task, no, { kind: 'retry', code: 'DEADLINE' });
      }, task.deadline_ms);
    }
    const info = { runId: spec.run_id, taskId: id, attemptNo: no, attemptId, idempotencyKey: `${spec.run_id}:${id}`, inputs, depAttempts: {}, task: { id, effect: task.effect, outputs: task.outputs, exec: task.exec, deadline_ms: task.deadline_ms } };
    const ctx = {
      signal: controller.signal,
      clock,
      deliver: (raw) => {
        if (timedOut) return; // the one concession to timeouts: a timed-out attempt's late answer is dropped
        if (timer) clock.clearTimeout(timer);
        onDelivery(task, no, attemptId, raw);
      },
    };
    let started;
    try { started = worker.execute(info, ctx); } catch (error) { started = Promise.reject(error); }
    Promise.resolve(started).catch(() => {
      if (timedOut) return;
      if (timer) clock.clearTimeout(timer);
      onOutcome(task, no, { kind: 'retry', code: 'WORKER_CRASH' });
    });
  }

  // Note what is missing: nothing checks that this attempt is still the one being waited for, or that it was
  // already counted. Every delivery is processed.
  function onDelivery(task, no, attemptId, raw) {
    onOutcome(task, no, interpret(task, attemptId, raw));
  }

  function onOutcome(task, no, verdict) {
    if (finished) return;
    const id = task.id;
    if (verdict.kind === 'success') {
      if (statuses.get(id) !== 'succeeded') digests.set(id, verdict.digest);
      statuses.set(id, 'succeeded');
      running--;
      observer({ type: 'settled', t: clock.now(), task: id, status: 'succeeded' });
      for (const c of children.get(id)) {
        remaining.set(c, remaining.get(c) - 1);
        if (remaining.get(c) === 0) queue.push(c);
      }
    } else {
      codes.set(id, verdict.code);
      if (verdict.kind === 'retry' && no < task.max_attempts && !cancelled) {
        running--;
        launch(task, no + 1);
        return pump();
      }
      statuses.set(id, 'failed');
      running--;
      observer({ type: 'settled', t: clock.now(), task: id, status: 'failed' });
      blockDescendants(id);
    }
    pump();
  }

  clock.setTimeout(pump, 0);
  return { promise, cancel: () => { cancelled = true; pump(); } };
}

module.exports = Object.freeze({ startNaiveParallel, startSequential });
