'use strict';

// Deterministic virtual clock. Time only advances when every pending promise continuation has run and
// the next timer is popped, so a run's outcome depends only on its inputs, never on machine speed.
// All reported latencies from simulations are *simulated* milliseconds.
class VirtualClock {
  constructor() {
    this.t = 0;
    this.seq = 0;
    this.timers = [];
    this.fired = 0;
  }

  now() { return this.t; }

  setTimeout(fn, ms) {
    const timer = { at: this.t + Math.max(0, Math.round(ms)), seq: this.seq++, fn, cancelled: false };
    let lo = 0;
    let hi = this.timers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.timers[mid];
      if (m.at < timer.at || (m.at === timer.at && m.seq < timer.seq)) lo = mid + 1; else hi = mid;
    }
    this.timers.splice(lo, 0, timer);
    return timer;
  }

  clearTimeout(timer) {
    if (timer) timer.cancelled = true;
  }

  _next() {
    while (this.timers.length) {
      const timer = this.timers.shift();
      if (!timer.cancelled) return timer;
    }
    return null;
  }

  // Drive the simulation until `promise` settles. If no timers remain while the promise is still
  // pending, the simulated system is deadlocked and we say so instead of hanging.
  async run(promise) {
    let done = false;
    let value;
    let failure;
    promise.then((v) => { done = true; value = v; }, (e) => { done = true; failure = { error: e }; });
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      if (done) break;
      const timer = this._next();
      if (!timer) throw new Error('virtual clock deadlock: no timers pending but the run has not finished');
      this.t = timer.at;
      this.fired++;
      timer.fn();
    }
    if (failure) throw failure.error;
    return value;
  }
}

module.exports = Object.freeze({ VirtualClock });
