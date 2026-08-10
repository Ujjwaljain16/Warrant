'use strict';

const { STATUS, TERMINAL, assertTransition } = require('./states');

// Dependency-aware scheduler.
//
// Unlike a counter that is decremented whenever a completion *message* arrives, the unmet-dependency
// counters here change only inside `transition()`, which is guarded by the state machine. Entering
// `succeeded` is possible at most once per task (terminal states absorb), so a dependency is counted
// at most once however many times its result is delivered. Per-operation cost is O(degree), plus
// O(descendants) when a failure blocks the downstream tasks.
class Scheduler {
  constructor(spec, initialStatuses = null) {
    this.spec = spec;
    this.index = new Map();      // id -> declaration index (deterministic dispatch order)
    this.tasks = new Map();      // id -> task
    this.children = new Map();   // id -> [child ids]
    this.status = new Map();
    this.unmet = new Map();
    spec.tasks.forEach((task, i) => {
      this.index.set(task.id, i);
      this.tasks.set(task.id, task);
      this.children.set(task.id, []);
      this.status.set(task.id, STATUS.PENDING);
    });
    for (const task of spec.tasks) for (const dep of task.deps) this.children.get(dep).push(task.id);
    this.ready = [];             // sorted by declaration index
    this.counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
    this.counts.pending = spec.tasks.length;
    for (const task of spec.tasks) this.unmet.set(task.id, task.deps.length);
    if (initialStatuses) this._restore(initialStatuses);
    else for (const task of spec.tasks) if (task.deps.length === 0) this._enqueue(task.id);
  }

  // Rebuild from known final/intermediate statuses (used by resume). Tasks must be `pending` or terminal;
  // blocked-ness is recomputed from scratch rather than trusted.
  _restore(initial) {
    for (const task of this.spec.tasks) {
      const s = Object.hasOwn(initial, task.id) ? initial[task.id] : STATUS.PENDING;
      if (s !== STATUS.PENDING && !TERMINAL.includes(s)) throw new Error(`cannot restore task ${task.id} in non-terminal status ${s}`);
      if (s === STATUS.BLOCKED) continue; // recomputed below
      this._setStatus(task.id, s);
    }
    for (const task of this.spec.tasks) {
      if (this.status.get(task.id) === STATUS.SUCCEEDED) for (const c of this.children.get(task.id)) this.unmet.set(c, this.unmet.get(c) - 1);
    }
    for (const task of this.spec.tasks) {
      const s = this.status.get(task.id);
      if (s !== STATUS.PENDING && s !== STATUS.SUCCEEDED) this._blockDescendants(task.id);
    }
    for (const task of this.spec.tasks) {
      if (this.status.get(task.id) === STATUS.PENDING && this.unmet.get(task.id) === 0) this._enqueue(task.id);
    }
  }

  _setStatus(id, next) {
    const prev = this.status.get(id);
    this.counts[prev]--;
    this.counts[next]++;
    this.status.set(id, next);
  }

  _enqueue(id) {
    const at = this.index.get(id);
    let lo = 0;
    let hi = this.ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.index.get(this.ready[mid]) < at) lo = mid + 1; else hi = mid;
    }
    if (this.ready[lo] === id) return;
    this.ready.splice(lo, 0, id);
  }

  _dequeue(id) {
    const i = this.ready.indexOf(id);
    if (i >= 0) this.ready.splice(i, 1);
  }

  _blockDescendants(id) {
    const stack = [...this.children.get(id)];
    while (stack.length) {
      const child = stack.pop();
      if (this.status.get(child) !== STATUS.PENDING) continue;
      this._dequeue(child);
      this._setStatus(child, STATUS.BLOCKED);
      stack.push(...this.children.get(child));
    }
  }

  statusOf(id) {
    return this.status.get(id);
  }

  readyCount() {
    return this.ready.length;
  }

  // Remove and return up to `limit` ready task ids in declaration order. The caller must immediately
  // transition each to `running` (or `cancelled`).
  takeReady(limit) {
    return this.ready.splice(0, Math.max(0, limit));
  }

  // A task that returned to `pending` for a retry becomes dispatchable again.
  release(id) {
    if (this.status.get(id) === STATUS.PENDING && this.unmet.get(id) === 0) this._enqueue(id);
  }

  transition(id, next) {
    const prev = this.status.get(id);
    if (prev === undefined) throw new Error(`unknown task ${id}`);
    assertTransition(id, prev, next);
    if (next === STATUS.RUNNING && this.unmet.get(id) !== 0) {
      throw new Error(`task ${id} dispatched with ${this.unmet.get(id)} unmet dependencies`);
    }
    this._dequeue(id);
    this._setStatus(id, next);
    if (next === STATUS.SUCCEEDED) {
      for (const c of this.children.get(id)) {
        this.unmet.set(c, this.unmet.get(c) - 1);
        if (this.unmet.get(c) === 0 && this.status.get(c) === STATUS.PENDING) this._enqueue(c);
      }
    } else if (TERMINAL.includes(next)) {
      this._blockDescendants(id);
    }
  }

  // Cancel every task that has not reached a terminal state. Returns the ids that were running/verifying.
  cancelAll() {
    const inFlight = [];
    for (const task of this.spec.tasks) {
      const s = this.status.get(task.id);
      if (s === STATUS.PENDING) { this._dequeue(task.id); this._setStatus(task.id, STATUS.CANCELLED); }
      else if (s === STATUS.RUNNING || s === STATUS.VERIFYING) { inFlight.push(task.id); this._setStatus(task.id, STATUS.CANCELLED); }
    }
    this.ready.length = 0;
    return inFlight;
  }

  allTerminal() {
    return this.counts.pending + this.counts.running + this.counts.verifying === 0;
  }

  snapshot() {
    return Object.fromEntries(this.status);
  }
}

module.exports = Object.freeze({ Scheduler });
