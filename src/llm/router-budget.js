'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LlmError, QuotaExhaustedError } = require('./errors');
const { warrantHome } = require('./quota');
const { DEFAULT_CAP_USD, ROUTER_BASE_URL, routerGetJson } = require('./router-models');

// A persistent, cross-process spend ledger with a hard cap, for the router whose credit is the only thing that can be spent.
//
//   reserve(worst case)  -> refuses the call when ledger spent + everything in flight + this call's worst case could exceed
//                           min(cap, balance - reserve); otherwise records the reservation
//   settle(actual)       -> replaces the reservation with the cost computed from the usage the API reported
//   release / chargeUnsettled -> the call certainly was not billed / may have been billed (charged at the worst case)
//
// Every mutation happens under an exclusive lock file (created with O_EXCL, so atomic on Windows and POSIX) and the ledger is
// replaced by write-temp-then-rename, so concurrent processes serialise and a crash leaves either the old or the new state.
// Anything unreadable, inconsistent or missing-but-previously-used is a BudgetLedgerError: the budget fails closed and never
// resets itself. Nothing here ever sees the API key.
const RESERVE_USD = 0.20;
const LEDGER_VERSION = 1;
const MAX_WARNINGS = 20;
const MAX_EXPIRED = 200;

// How GET /credits maps to the remaining balance. The router returned {total_credits: 0.89698193, total_usage: 0.10301807} when
// its dashboard read $0.90, which fits `total_credits` = remaining; 'min' (the smaller of that and total_credits - total_usage)
// is the default until a paid call has been observed to settle it (docs/ROUTER.md records the observation).
const CREDITS_SEMANTICS = Object.freeze(['remaining', 'purchased_minus_usage', 'min']);
const VERIFIED_CREDITS_SEMANTICS = 'remaining';

class BudgetExhaustedError extends QuotaExhaustedError {
  constructor(detail, extra = {}) {
    super('router', detail, extra);
    this.name = 'BudgetExhaustedError';
    this.code = 'BUDGET_EXHAUSTED';
    this.message = `router spend cap reached: ${detail}`;
  }
}

// The ledger itself cannot be trusted (corrupt, locked for too long, previously used but gone). Stops the run like an exhausted budget.
class BudgetLedgerError extends BudgetExhaustedError {
  constructor(detail, extra = {}) {
    super(detail, extra);
    this.name = 'BudgetLedgerError';
    this.code = 'BUDGET_LEDGER';
    this.message = `router budget ledger unusable (failing closed): ${detail}`;
  }
}

const round9 = (n) => Math.round(n * 1e9) / 1e9;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const usd = (n) => `$${n.toFixed(6)}`;

function capFromEnv(env = process.env) {
  const raw = env.WARRANT_ROUTER_CAP_USD;
  if (raw === undefined || raw === '') return DEFAULT_CAP_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new BudgetLedgerError(`WARRANT_ROUTER_CAP_USD must be a positive number of dollars, got "${String(raw).slice(0, 20)}"`);
  return n;
}

// GET /credits -> {totalCredits, totalUsage}. Strict: anything that is not two finite non-negative numbers is an error.
async function fetchCredits(options = {}) {
  const json = await routerGetJson('/credits', { baseUrl: ROUTER_BASE_URL, ...options });
  const d = json && json.data;
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!d || !ok(d.total_credits) || !ok(d.total_usage)) throw new LlmError('BAD_RESPONSE', 'GET /credits: expected data.total_credits and data.total_usage as non-negative numbers');
  return { totalCredits: d.total_credits, totalUsage: d.total_usage };
}

function remainingFrom(credits, semantics) {
  if (semantics === 'remaining') return credits.totalCredits;
  const other = Math.max(0, credits.totalCredits - credits.totalUsage);
  return semantics === 'purchased_minus_usage' ? other : Math.min(credits.totalCredits, other);
}

// Money the server says has gone since `baseline`, by the chosen reading of /credits (the larger of the two when unsure).
function serverSpendSince(baseline, now, semantics) {
  const byBalance = Math.max(0, baseline.totalCredits - now.totalCredits);
  const byUsage = Math.max(0, now.totalUsage - baseline.totalUsage);
  if (semantics === 'remaining') return byBalance;
  if (semantics === 'purchased_minus_usage') return byUsage;
  return Math.max(byBalance, byUsage);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function bodyChecksum(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

function freshState(now) {
  return { version: LEDGER_VERSION, createdAt: now, spentUsd: 0, unsettledUsd: 0, calls: 0, reservations: {}, expired: {}, snapshot: null, baseline: null, warnings: [], adjustments: [] };
}

class RouterBudget {
  constructor({
    env = process.env, dir = path.join(warrantHome(env), 'router'), capUsd = capFromEnv(env), reserveUsd = RESERVE_USD,
    fetchCredits: fetchFn = () => fetchCredits({ env }), semantics = VERIFIED_CREDITS_SEMANTICS, now = Date.now, pid = process.pid,
    refreshMs = 10 * 60_000, refreshCalls = 25, maxSnapshotAgeMs = 60 * 60_000, lockTimeoutMs = 15_000, staleLockMs = 30_000,
    reservationTtlMs = 30 * 60_000, deadPidGraceMs = 120_000, onWarning = null,
  } = {}) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new BudgetLedgerError('the cap must be a positive number of dollars');
    if (!CREDITS_SEMANTICS.includes(semantics)) throw new TypeError(`semantics must be one of ${CREDITS_SEMANTICS.join(', ')}`);
    Object.assign(this, { dir, capUsd, reserveUsd, fetchFn, semantics, now, pid, refreshMs, refreshCalls, maxSnapshotAgeMs, lockTimeoutMs, staleLockMs, reservationTtlMs, deadPidGraceMs, onWarning });
    this.file = path.join(dir, 'ledger.json');
    this.lockFile = path.join(dir, 'ledger.lock');
    this.logFile = path.join(dir, 'spend.log');
    this.tail = Promise.resolve();
    this.refreshing = null;
  }

  // ------------------------------------------------------------ storage

  _read() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw new BudgetLedgerError(`cannot read ${this.file} (${error.code || 'error'})`);
      if (fs.existsSync(this.logFile)) throw new BudgetLedgerError(`${this.file} is missing but ${this.logFile} shows earlier spending; restore the ledger (delete both only to reset on purpose)`);
      return freshState(this.now());
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch (_error) { throw new BudgetLedgerError(`${this.file} is not valid JSON (corrupted)`); }
    const { sum, ...body } = parsed || {};
    const numbers = [body.spentUsd, body.unsettledUsd, body.calls];
    const valid = parsed && typeof parsed === 'object' && body.version === LEDGER_VERSION && numbers.every((n) => Number.isFinite(n) && n >= 0)
      && body.reservations && typeof body.reservations === 'object' && body.expired && typeof body.expired === 'object'
      && Array.isArray(body.warnings) && Array.isArray(body.adjustments);
    if (!valid) throw new BudgetLedgerError(`${this.file} has an unexpected shape (corrupted)`);
    if (sum !== bodyChecksum(body)) throw new BudgetLedgerError(`${this.file} failed its integrity check (edited or corrupted)`);
    for (const r of Object.values(body.reservations)) if (!r || !Number.isFinite(r.usd) || r.usd < 0) throw new BudgetLedgerError(`${this.file} has a malformed reservation`);
    return body;
  }

  _write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify({ ...state, sum: bodyChecksum(state) });
    const tmp = `${this.file}.${this.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, text);
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, this.file); return; } catch (error) {
        // Windows reports EPERM/EBUSY/EACCES while another process has the target open; the window is a few milliseconds.
        if (attempt >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
          try { fs.unlinkSync(tmp); } catch (_e) { /* best effort */ }
          throw new BudgetLedgerError(`cannot replace ${this.file} (${error.code || 'error'})`);
        }
        sleepSync(5 + attempt);
      }
    }
  }

  _log(entry) {
    fs.appendFileSync(this.logFile, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })}\n`);
  }

  _warn(state, message) {
    state.warnings.push({ at: this.now(), message });
    if (state.warnings.length > MAX_WARNINGS) state.warnings.splice(0, state.warnings.length - MAX_WARNINGS);
    if (this.onWarning) { try { this.onWarning(message); } catch (_error) { /* a warning hook must not break accounting */ } }
  }

  // ------------------------------------------------------------ lock

  _tryBreakStale() {
    let stat;
    let before;
    try { stat = fs.statSync(this.lockFile); before = fs.readFileSync(this.lockFile, 'utf8'); } catch (_error) { return; }
    if (this.now() - stat.mtimeMs < this.staleLockMs) return;
    const moved = `${this.lockFile}.stale.${this.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try { fs.renameSync(this.lockFile, moved); } catch (_error) { return; }
    let after = null;
    try { after = fs.readFileSync(moved, 'utf8'); } catch (_error) { /* gone */ }
    if (after === before) { try { fs.unlinkSync(moved); } catch (_error) { /* best effort */ } return; }
    // We moved a lock that was taken by someone else in the meantime: put it back if the path is still free.
    try { if (!fs.existsSync(this.lockFile)) fs.renameSync(moved, this.lockFile); } catch (_error) { /* nothing more to do */ }
  }

  async _withLock(fn) {
    const run = this.tail.then(() => this._lockedRun(fn));
    this.tail = run.catch(() => {});
    return run;
  }

  async _lockedRun(fn) {
    fs.mkdirSync(this.dir, { recursive: true });
    const token = `${this.pid}.${crypto.randomBytes(8).toString('hex')}`;
    const started = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(this.lockFile, 'wx');
        try { fs.writeSync(fd, token); } finally { fs.closeSync(fd); }
        break;
      } catch (error) {
        if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw new BudgetLedgerError(`cannot create the ledger lock (${error.code || 'error'})`);
        this._tryBreakStale();
        if (Date.now() - started > this.lockTimeoutMs) throw new BudgetLedgerError(`could not get the ledger lock within ${this.lockTimeoutMs} ms`);
        await sleep(3 + Math.floor(Math.random() * 12));
      }
    }
    try {
      return fn();
    } finally {
      try { if (fs.readFileSync(this.lockFile, 'utf8') === token) fs.unlinkSync(this.lockFile); } catch (_error) { /* lock already gone or taken over */ }
    }
  }

  // ------------------------------------------------------------ accounting (all called with the lock held)

  _expire(state) {
    const t = this.now();
    for (const [id, r] of Object.entries(state.reservations)) {
      const age = t - r.at;
      const deadOwner = r.pid !== this.pid && age > this.deadPidGraceMs && !pidAlive(r.pid);
      if (age <= this.reservationTtlMs && !deadOwner) continue;
      // The call may have reached the router before its process died: it is charged at its worst case, never forgiven.
      delete state.reservations[id];
      state.spentUsd = round9(state.spentUsd + r.usd);
      state.unsettledUsd = round9(state.unsettledUsd + r.usd);
      state.expired[id] = r.usd;
      this._log({ kind: 'expired', id, model: r.model, usd: r.usd });
      this._warn(state, `reservation ${id} (${r.model}) never settled; charged at its worst case ${usd(r.usd)}`);
    }
    const ids = Object.keys(state.expired);
    if (ids.length > MAX_EXPIRED) for (const id of ids.slice(0, ids.length - MAX_EXPIRED)) delete state.expired[id];
  }

  _reservedUsd(state) {
    return round9(Object.values(state.reservations).reduce((s, r) => s + r.usd, 0));
  }

  _balanceEstimate(state) {
    if (!state.snapshot) return null;
    return remainingFrom(state.snapshot.credits, this.semantics) - Math.max(0, state.spentUsd - state.snapshot.spentAtSnapshot);
  }

  // Total spend the ledger may reach: the cap, and never more than what the balance can cover after keeping the reserve.
  _effectiveCap(state) {
    const balance = this._balanceEstimate(state);
    if (balance === null) return 0;
    return Math.max(0, Math.min(this.capUsd, round9(state.spentUsd + balance - this.reserveUsd)));
  }

  _summary(state) {
    const reserved = this._reservedUsd(state);
    const cap = this._effectiveCap(state);
    return {
      spentUsd: state.spentUsd, unsettledUsd: state.unsettledUsd, reservedUsd: reserved, calls: state.calls, capUsd: this.capUsd,
      effectiveCapUsd: cap, headroomUsd: Math.max(0, round9(cap - state.spentUsd - reserved)), balanceEstimateUsd: this._balanceEstimate(state),
      snapshotAt: state.snapshot ? state.snapshot.at : null, semantics: this.semantics, warnings: state.warnings.slice(),
    };
  }

  _applySnapshot(state, credits) {
    const t = this.now();
    state.snapshot = { credits, at: t, spentAtSnapshot: state.spentUsd, callsAtSnapshot: state.calls };
    if (!state.baseline) {
      state.baseline = { credits, at: t, ledgerSpent: state.spentUsd };
      return null;
    }
    const server = round9(serverSpendSince(state.baseline.credits, credits, this.semantics));
    const ledgerLo = round9(state.spentUsd - state.baseline.ledgerSpent);
    const ledgerHi = round9(ledgerLo + this._reservedUsd(state));
    const slack = 0.0005;
    if (server > ledgerHi * 1.2 + slack) {
      // The server has been charged more than this ledger can account for: trust the server (never the smaller number).
      const diff = round9(server - ledgerHi);
      state.spentUsd = round9(state.spentUsd + diff);
      state.adjustments.push({ at: t, kind: 'server_higher', ledger: ledgerHi, server, added: diff });
      this._log({ kind: 'adjust_up', usd: diff });
      this._warn(state, `ledger vs /credits disagree by more than 20%: the router charged ${usd(server)} since the baseline, the ledger had ${usd(ledgerHi)}; ledger raised by ${usd(diff)}`);
    } else if (server < ledgerLo * 0.8 - slack) {
      this._warn(state, `ledger vs /credits disagree by more than 20%: the ledger counts ${usd(ledgerLo)} since the baseline, the router only ${usd(server)} (the ledger is kept: it errs high)`);
    }
    return { server, ledger: ledgerLo };
  }

  // ------------------------------------------------------------ public API

  // Re-reads GET /credits when there is no snapshot, or it is older than refreshMs or refreshCalls calls old. Never holds the lock
  // while on the network. Fails closed when no usable snapshot exists.
  async refreshBalance({ force = false } = {}) {
    const peek = this._peek();
    const stale = !peek.snapshot || force || this.now() - peek.snapshot.at > this.refreshMs || peek.calls - peek.snapshot.callsAtSnapshot >= this.refreshCalls;
    if (!stale) return this.status();
    if (!this.refreshing) {
      this.refreshing = (async () => {
        let credits;
        try { credits = await this.fetchFn(); } catch (error) {
          const age = peek.snapshot ? this.now() - peek.snapshot.at : Infinity;
          if (age > this.maxSnapshotAgeMs) throw new BudgetLedgerError(`cannot read the router balance (${error && error.code ? error.code : 'error'}) and the last reading is ${Number.isFinite(age) ? `${Math.round(age / 60000)} min old` : 'missing'}`);
          return;
        }
        await this._withLock(() => {
          const state = this._read();
          this._expire(state);
          this._applySnapshot(state, credits);
          this._write(state);
        });
      })().finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
    return this.status();
  }

  _peek() {
    try { return this._read(); } catch (error) {
      if (error instanceof BudgetLedgerError) throw error;
      throw new BudgetLedgerError('cannot read the ledger');
    }
  }

  status() {
    return this._summary(this._peek());
  }

  // Reserves `worstCaseUsd` or throws BudgetExhaustedError. Returns {id, usd}.
  async reserve({ model, worstCaseUsd }) {
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd < 0) throw new BudgetLedgerError('worst-case cost must be a finite non-negative number');
    await this.refreshBalance();
    return this._withLock(() => {
      const state = this._read();
      this._expire(state);
      const summary = this._summary(state);
      if (state.snapshot === null) throw new BudgetExhaustedError('the router balance has never been read');
      if (worstCaseUsd > summary.headroomUsd + 1e-12) {
        this._write(state);
        throw new BudgetExhaustedError(`this call could cost up to ${usd(worstCaseUsd)} but only ${usd(summary.headroomUsd)} is left under the ${usd(summary.effectiveCapUsd)} cap `
          + `(spent ${usd(summary.spentUsd)}, in flight ${usd(summary.reservedUsd)}; cap = min($${this.capUsd}, balance - $${this.reserveUsd} reserve))`, { spent: summary.spentUsd, capUsd: summary.effectiveCapUsd, model });
      }
      const id = `${this.pid}-${crypto.randomBytes(6).toString('hex')}`;
      state.reservations[id] = { usd: round9(worstCaseUsd), model, pid: this.pid, at: this.now() };
      this._write(state);
      return { id, usd: round9(worstCaseUsd) };
    });
  }

  // The call finished and the reply reported its usage: charge the real cost.
  async settle(reservation, actualUsd, { model = null } = {}) {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new BudgetLedgerError('actual cost must be a finite non-negative number');
    return this._withLock(() => {
      const state = this._read();
      this._expire(state);
      const reserved = state.reservations[reservation.id];
      if (reserved) delete state.reservations[reservation.id];
      let delta = actualUsd;
      if (!reserved && Object.hasOwn(state.expired, reservation.id)) {
        // Its reservation was already charged at the worst case when it expired: correct that charge instead of adding to it.
        delta = actualUsd - state.expired[reservation.id];
        state.unsettledUsd = round9(Math.max(0, state.unsettledUsd - state.expired[reservation.id]));
        delete state.expired[reservation.id];
      }
      state.spentUsd = round9(Math.max(0, state.spentUsd + delta));
      state.calls += 1;
      this._log({ kind: 'settle', id: reservation.id, model: model || (reserved && reserved.model) || null, usd: round9(actualUsd) });
      this._write(state);
      return this._summary(state);
    });
  }

  // The call certainly did not reach billing (rejected before dispatch, or a clear HTTP error): free the reservation.
  async release(reservation) {
    return this._withLock(() => {
      const state = this._read();
      delete state.reservations[reservation.id];
      this._write(state);
    });
  }

  // The call may or may not have been billed (timeout, dropped connection): it stays charged at its worst case.
  async chargeUnsettled(reservation, { reason = 'ambiguous' } = {}) {
    return this._withLock(() => {
      const state = this._read();
      const reserved = state.reservations[reservation.id];
      if (!reserved) return this._summary(state);
      delete state.reservations[reservation.id];
      state.spentUsd = round9(state.spentUsd + reserved.usd);
      state.unsettledUsd = round9(state.unsettledUsd + reserved.usd);
      this._log({ kind: 'unsettled', id: reservation.id, model: reserved.model, usd: reserved.usd, reason });
      this._write(state);
      return this._summary(state);
    });
  }
}

// node src/llm/router-budget.js status      (offline: the ledger, the cap and the last balance reading)
// node src/llm/router-budget.js reconcile   (WARRANT_LIVE=1: GET /credits, compares it with the ledger, never spends)
if (require.main === module) {
  const write = (text) => process.stdout.write(`${text}\n`);
  const budget = new RouterBudget({ onWarning: (m) => write(`WARNING: ${m}`) });
  const command = process.argv[2];
  const run = async () => {
    if (command === 'status') { write(JSON.stringify(budget.status(), null, 2)); return 0; }
    if (command === 'reconcile') { write(JSON.stringify(await budget.refreshBalance({ force: true }), null, 2)); return 0; }
    write('usage: router-budget.js status | reconcile');
    return 2;
  };
  run().then((code) => { process.exitCode = code; }, (error) => { write(`router-budget: ${String(error && error.message ? error.message : error).slice(0, 300)}`); process.exitCode = 1; });
}

module.exports = Object.freeze({
  BudgetExhaustedError, BudgetLedgerError, CREDITS_SEMANTICS, DEFAULT_CAP_USD, RESERVE_USD, RouterBudget, VERIFIED_CREDITS_SEMANTICS,
  capFromEnv, fetchCredits, remainingFrom, serverSpendSince,
});
