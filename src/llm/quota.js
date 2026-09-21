'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { limitsFor, resolveModel } = require('./limits');

// Default home for persisted state. Lives under the user profile, outside the repository, so nothing here can be committed.
function warrantHome(env = process.env) {
  return path.join(env.USERPROFILE || env.HOME || os.homedir(), '.warrant');
}

// Quotas reset at midnight US Pacific, so "today" is the Pacific calendar date.
function pacificDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * Per-day, per-model request counter persisted to disk, so quota use survives restarts and is shared by every process on the machine.
 *
 * Each call appends ONE byte to `calls-<day>-<model>.log` (O_APPEND: the kernel serialises concurrent appends, so no update is ever lost,
 * where a read-modify-write of a JSON file loses some and, on Windows, fails with EPERM when two processes rename over each other);
 * the count is the file's size. `markExhausted` writes a marker file (the provider itself said the day's quota is gone).
 * The older single-file format (`calls-<day>.json`) is still read, never written, so counts made before this change are kept.
 */
class DailyCounter {
  constructor({ dir = path.join(warrantHome(), 'quota'), now = Date.now } = {}) {
    this.dir = dir;
    this.now = now;
  }

  _legacy(day) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.dir, `calls-${day}.json`), 'utf8'));
      return {
        counts: parsed && typeof parsed.counts === 'object' && parsed.counts ? parsed.counts : {},
        exhausted: Array.isArray(parsed && parsed.exhausted) ? parsed.exhausted : [],
      };
    } catch (_error) {
      return { counts: {}, exhausted: [] };
    }
  }

  _log(day, id) {
    return path.join(this.dir, `calls-${day}-${id}.log`);
  }

  _marker(day, id) {
    return path.join(this.dir, `exhausted-${day}-${id}`);
  }

  today() {
    return pacificDay(this.now());
  }

  _size(file) {
    try { return fs.statSync(file).size; } catch (_error) { return 0; }
  }

  count(model) {
    const id = resolveModel(model);
    const day = this.today();
    const old = this._legacy(day).counts[id];
    return (Number.isFinite(old) && old > 0 ? Math.floor(old) : 0) + this._size(this._log(day, id));
  }

  isExhausted(model) {
    const id = resolveModel(model);
    const day = this.today();
    return fs.existsSync(this._marker(day, id)) || this._legacy(day).exhausted.includes(id) || this.count(id) >= limitsFor(id).rpd;
  }

  remaining(model) {
    const id = resolveModel(model);
    const day = this.today();
    if (fs.existsSync(this._marker(day, id)) || this._legacy(day).exhausted.includes(id)) return 0;
    return Math.max(0, limitsFor(id).rpd - this.count(id));
  }

  // A transient EPERM/EBUSY/EACCES (another process holds the file open, a virus scanner looks at it) is retried; nothing else is hidden.
  _retry(fn) {
    for (let attempt = 0; ; attempt++) {
      try { return fn(); } catch (error) {
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES', 'EMFILE'].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1));
      }
    }
  }

  increment(model) {
    const id = resolveModel(model);
    const day = this.today();
    this._retry(() => { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this._log(day, id), '.'); });
    return this.count(id);
  }

  markExhausted(model) {
    const id = resolveModel(model);
    const day = this.today();
    this._retry(() => { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this._marker(day, id), '1'); });
  }
}

/**
 * In-process per-model limiter for requests/minute and input tokens/minute (sliding 60 s window).
 * `now` and `sleep` are injectable so tests run on virtual time. Callers are served in order.
 */
class RateLimiter {
  constructor({ now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), limits = limitsFor } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.limits = limits;
    this.windows = new Map(); // model -> [{ t, tokens }]
    this.tail = Promise.resolve();
  }

  // Resolves once a request of `tokens` input tokens may be sent; the request is recorded at that moment.
  acquire(model, tokens = 0) {
    const run = this.tail.then(() => this._acquire(resolveModel(model), tokens));
    this.tail = run.catch(() => {});
    return run;
  }

  async _acquire(model, tokens) {
    const { rpm, tpm } = this.limits(model);
    const entries = this.windows.get(model) || [];
    this.windows.set(model, entries);
    for (;;) {
      const t = this.now();
      while (entries.length && entries[0].t <= t - 60_000) entries.shift();
      const used = entries.reduce((sum, e) => sum + e.tokens, 0);
      const requestOk = entries.length < rpm;
      // A single request larger than the whole minute budget could never be admitted; let it through alone.
      const tokensOk = used + tokens <= tpm || entries.length === 0;
      if (requestOk && tokensOk) {
        entries.push({ t, tokens });
        return;
      }
      let wait = 60_000 - (t - entries[0].t);
      if (requestOk && !tokensOk) {
        // wait until enough older entries age out
        let freed = 0;
        for (const e of entries) {
          freed += e.tokens;
          if (used - freed + tokens <= tpm) { wait = 60_000 - (t - e.t); break; }
        }
      }
      await this.sleep(Math.max(1, wait));
    }
  }

  // Replace the estimate recorded for the most recent request with the provider's real input-token count.
  correctLast(model, tokens) {
    const entries = this.windows.get(resolveModel(model));
    if (entries && entries.length) entries[entries.length - 1].tokens = tokens;
  }
}

module.exports = Object.freeze({ DailyCounter, RateLimiter, pacificDay, warrantHome });
