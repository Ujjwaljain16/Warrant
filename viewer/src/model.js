'use strict';

// Folds a log into per-task timelines, attempt outcomes and state transitions. Pure and total: it never throws on
// hostile input (unknown fields, wrong types, tasks that do not exist) and never uses log strings as object keys
// (Maps only). Its final statuses and attempt counts agree with replayLog in src/engine/replay.js.

const { canTransition } = require('./states');

const MAX_LIST = 64;

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function str(x) { return typeof x === 'string' ? x : null; }
function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : null; }
function strList(x) { return Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, MAX_LIST) : []; }

function newTask(id, order) {
  return {
    id, order, declared: false, unknown: false,
    status: null, code: null, attempts: 0, settledSeq: null, settledAttempt: null, digest: null,
    notVerified: [], maybeApplied: false,
    attemptList: [], byAttemptId: new Map(), events: [], verdict: null,
    transitions: [], state: 'pending', cancelledInFlight: false,
    def: null,
  };
}

function summariseVerdict(e, data) {
  return {
    seq: e.seq, t: e.t, status: str(data.status) || '?', digest: str(data.digest),
    passed: strList(data.passed), failed: strList(data.failed), notVerified: strList(data.not_verified),
    claimOnly: data.claim_only === true,
  };
}

function buildModel(entries, { spec = null } = {}) {
  const tasks = new Map();
  const global = {
    runStarts: [], cancel: null, finished: null, duplicates: 0, events: [],
    resumed: false, specDigest: null,
  };
  const orderOf = () => tasks.size;
  const getTask = (id) => {
    if (!tasks.has(id)) tasks.set(id, newTask(id, orderOf()));
    return tasks.get(id);
  };

  if (spec && Array.isArray(spec.tasks)) {
    for (const def of spec.tasks) {
      if (!isObj(def) || typeof def.id !== 'string' || tasks.has(def.id)) continue;
      const task = getTask(def.id);
      task.declared = true;
      task.def = def;
    }
  }

  let seqMax = 0;
  const times = new Set();
  let tMin = Infinity;
  let tMax = -Infinity;

  const move = (task, to, e, cause) => {
    if (task.state === to) return;
    task.transitions.push({ from: task.state, to, seq: e.seq, t: e.t, cause, legal: canTransition(task.state, to) });
    task.state = to;
  };

  const attemptFor = (task, e, createGhost) => {
    const id = str(e.attempt);
    if (id !== null && task.byAttemptId.has(id)) return task.byAttemptId.get(id);
    if (id === null) {
      const last = task.attemptList[task.attemptList.length - 1];
      if (last) return last;
    }
    if (!createGhost) return null;
    const ghost = newAttempt(id, null, e);
    ghost.ghost = true;
    task.attemptList.push(ghost);
    if (id !== null) task.byAttemptId.set(id, ghost);
    return ghost;
  };

  function newAttempt(id, no, e) {
    return {
      id, no, startSeq: e.seq, startT: e.t, endSeq: e.seq, endT: e.t, ghost: false,
      result: null, verdict: null, ambiguous: null, reconcile: null, failed: null, duplicates: [], settled: null,
      events: [], kind: 'open', label: '', accepted: false, key: null, effect: null,
    };
  }

  entries.forEach((raw, index) => {
    if (!isObj(raw)) return;
    const e = { ...raw, seq: num(raw.seq) !== null ? raw.seq : index + 1, t: num(raw.t) !== null ? raw.t : 0, index };
    const type = str(e.type) || '?';
    const data = isObj(e.data) ? e.data : {};
    seqMax = Math.max(seqMax, e.seq);
    times.add(e.t);
    tMin = Math.min(tMin, e.t);
    tMax = Math.max(tMax, e.t);
    e.dataObj = data;
    global.events.push(e);

    const taskId = str(e.task);
    const task = taskId !== null && type !== 'run_started' && type !== 'run_finished' && type !== 'cancel_requested' ? getTask(taskId) : null;
    if (task) { task.events.push(e); if (spec && !task.declared) task.unknown = true; }

    switch (type) {
      case 'run_started':
        global.runStarts.push({ seq: e.seq, t: e.t, specDigest: str(data.spec_digest), resumed: data.resumed === true, tasks: num(data.tasks) });
        if (global.specDigest === null) global.specDigest = str(data.spec_digest);
        if (data.resumed === true) global.resumed = true;
        break;
      case 'attempt_started': {
        if (!task) break;
        const no = num(data.no);
        const att = newAttempt(str(e.attempt) || `${task.id}.${no === null ? '?' : no}`, no, e);
        att.key = str(data.key);
        att.effect = str(data.effect);
        att.events.push(e);
        task.attemptList.push(att);
        task.byAttemptId.set(att.id, att);
        if (no !== null) task.attempts = Math.max(task.attempts, no);
        move(task, 'running', e, `attempt ${no === null ? '?' : no} started`);
        break;
      }
      case 'attempt_result': {
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.result = { seq: e.seq, t: e.t, claim: str(data.claim) || '?', code: str(data.code), retryable: data.retryable === true, digest: str(data.digest) };
        if (att.result.claim === 'success') move(task, 'verifying', e, 'worker claimed success; the gate checks it');
        break;
      }
      case 'gate_verdict': {
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.verdict = summariseVerdict(e, data);
        task.verdict = att.verdict;
        if (task.state === 'running') move(task, 'verifying', e, 'reconcile found the effect applied; the gate checks it');
        break;
      }
      case 'attempt_ambiguous': {
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.ambiguous = { seq: e.seq, t: e.t, code: str(data.code) || '?', detail: str(data.detail) };
        break;
      }
      case 'reconcile': {
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.reconcile = { seq: e.seq, t: e.t, outcome: str(data.outcome) || '?' };
        break;
      }
      case 'attempt_failed': {
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.failed = { seq: e.seq, t: e.t, code: str(data.code) || '?', retry: data.retry === true, backoffMs: num(data.backoff_ms) };
        if (att.failed.retry) move(task, 'pending', e, `${att.failed.code}: attempt will be retried`);
        break;
      }
      case 'duplicate_ignored': {
        global.duplicates++;
        if (!task) break;
        const att = attemptFor(task, e, true);
        att.duplicates.push({ seq: e.seq, t: e.t, reason: str(data.reason) || '?' });
        break;
      }
      case 'task_settled': {
        if (!task) break;
        const att = e.attempt !== undefined ? attemptFor(task, e, true) : null;
        task.status = str(data.status) || '?';
        task.code = str(data.code);
        task.settledSeq = e.seq;
        task.settledT = e.t;
        task.settledAttempt = str(e.attempt);
        task.digest = str(data.digest);
        task.notVerified = strList(data.not_verified);
        task.maybeApplied = data.effect_maybe_applied === true;
        if (att) att.settled = { seq: e.seq, t: e.t, status: task.status };
        if (!att && task.status === 'cancelled') {
          const last = task.attemptList[task.attemptList.length - 1];
          if (last && !last.failed && !last.verdict && !last.result) { last.cancelled = true; task.cancelledInFlight = true; }
        }
        move(task, task.status, e, task.code ? `settled: ${task.code}` : 'settled');
        break;
      }
      case 'cancel_requested':
        global.cancel = { seq: e.seq, t: e.t, reason: str(data.reason) };
        break;
      case 'run_finished':
        global.finished = { seq: e.seq, t: e.t, status: str(data.status) || '?', counts: isObj(data.counts) ? data.counts : null };
        break;
      default:
        break;
    }

    if (task) {
      const id = str(e.attempt);
      const att = id !== null ? task.byAttemptId.get(id) : (type === 'task_settled' ? null : task.attemptList[task.attemptList.length - 1]);
      if (att) {
        if (type !== 'attempt_started') att.events.push(e);
        att.endSeq = Math.max(att.endSeq, e.seq);
        att.endT = Math.max(att.endT, e.t);
      }
    }
  });

  // Attempt outcomes (kind drives shape and colour, label drives the words).
  for (const task of tasks.values()) {
    for (const att of task.attemptList) {
      att.accepted = task.status === 'succeeded' && task.settledAttempt === att.id;
      if (att.accepted) { att.kind = 'accepted'; att.label = 'accepted'; continue; }
      if (att.verdict) {
        if (att.verdict.status === 'fail') { att.kind = 'rejected'; att.label = att.verdict.failed.length ? `gate rejected: ${att.verdict.failed.join(', ')}` : 'gate rejected'; }
        else if (att.verdict.status === 'pass') { att.kind = 'accepted'; att.label = 'gate passed'; }
        else { att.kind = 'unverified'; att.label = att.verdict.notVerified.length ? `not verified: ${att.verdict.notVerified.join(', ')}` : 'not verified'; }
        continue;
      }
      if (att.cancelled) { att.kind = 'cancelled'; att.label = 'cancelled in flight'; continue; }
      if (att.reconcile || att.ambiguous) {
        att.kind = 'ambiguous';
        const how = att.reconcile ? `reconcile: ${att.reconcile.outcome.replace('_', ' ')}` : 'outcome ambiguous';
        att.label = att.ambiguous ? `${att.ambiguous.code} → ${how}` : how;
        continue;
      }
      if (att.result && att.result.claim !== 'success') {
        att.kind = 'failed';
        att.label = att.result.claim === 'failure' ? `worker reported failure${att.result.code ? `: ${att.result.code}` : ''}` : `invalid result${att.result.code ? `: ${att.result.code}` : ''}`;
        continue;
      }
      if (att.failed) {
        att.kind = att.failed.code === 'DEADLINE' ? 'timeout' : 'crashed';
        att.label = att.failed.code === 'DEADLINE' ? 'deadline exceeded' : att.failed.code;
        continue;
      }
      att.kind = 'open';
      att.label = task.status === null ? 'no outcome in log' : 'no result recorded';
    }
  }

  // Final status per task for display; 'pending' = never touched, 'running' = started but not settled.
  for (const task of tasks.values()) {
    task.finalStatus = task.status !== null ? task.status : (task.attemptList.length ? 'running' : 'pending');
  }

  return {
    tasks,
    taskOrder: [...tasks.values()].sort((a, b) => a.order - b.order).map((t) => t.id),
    global,
    seqMax,
    tMin: times.size ? tMin : 0,
    tMax: times.size ? tMax : 0,
    tMeaningful: times.size >= 2 && tMax > tMin,
    eventCount: global.events.length,
  };
}

// Counts used by the header and the summary.
function tally(model) {
  const byStatus = new Map();
  let attempts = 0;
  let rejected = 0;
  let retries = 0;
  let crashed = 0;
  let reconciles = 0;
  let claimOnly = 0;
  for (const task of model.tasks.values()) {
    byStatus.set(task.finalStatus, (byStatus.get(task.finalStatus) || 0) + 1);
    attempts += task.attemptList.filter((a) => !a.ghost).length;
    for (const att of task.attemptList) {
      if (att.kind === 'rejected') rejected++;
      if (att.failed && att.failed.retry) retries++;
      if (att.kind === 'crashed' || att.kind === 'timeout') crashed++;
      if (att.reconcile) reconciles++;
    }
    if (task.status === 'succeeded' && task.verdict && task.verdict.claimOnly) claimOnly++;
  }
  return { byStatus, attempts, rejected, retries, crashed, reconciles, claimOnly, duplicates: model.global.duplicates };
}

module.exports = { buildModel, tally };
