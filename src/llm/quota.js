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
 * Per-day, per-model request counter persisted to disk, so quota use survives restarts.
 * One small JSON file per Pacific day; writes are atomic (temp file + rename).
 * `markExhausted` records that the provider itself said the day's quota is gone.
 */
class DailyCounter {
  constructor({ dir = path.join(warrantHome(), 'quota'), now = Date.now } = {}) {
    this.dir = dir;
    this.now = now;
  }

  _file(day) {
    return path.join(this.dir, `calls-${day}.json`);
  }

  _read(day) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this._file(day), 'utf8'));
      return {
        counts: parsed && typeof parsed.counts === 'object' && parsed.counts ? parsed.counts : {},
        exhausted: Array.isArray(parsed && parsed.exhausted) ? parsed.exhausted : [],
      };
    } catch (_error) {
      return { counts: {}, exhausted: [] };
    }
  }

  _write(day, state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this._file(day);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  }

  today() {
    return pacificDay(this.now());
  }

  count(model) {
    const state = this._read(this.today());
    return state.counts[resolveModel(model)] || 0;
  }

  isExhausted(model) {
    const id = resolveModel(model);
    const state = this._read(this.today());
    return state.exhausted.includes(id) || (state.counts[id] || 0) >= limitsFor(id).rpd;
  }

  remaining(model) {
    const id = resolveModel(model);
    if (this._read(this.today()).exhausted.includes(id)) return 0;
    return Math.max(0, limitsFor(id).rpd - this.count(id));
  }

  increment(model) {
    const day = this.today();
    const id = resolveModel(model);
    const state = this._read(day);
    state.counts[id] = (state.counts[id] || 0) + 1;
    this._write(day, state);
    return state.counts[id];
  }

  markExhausted(model) {
    const day = this.today();
    const id = resolveModel(model);
    const state = this._read(day);
    if (!state.exhausted.includes(id)) state.exhausted.push(id);
    this._write(day, state);
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
