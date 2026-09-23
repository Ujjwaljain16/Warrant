'use strict';

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
    if (!ok(capacity) || !ok(refillPerSecond)) throw new RangeError('capacity and refillPerSecond must be finite numbers greater than 0');
    this.capacity = capacity;
    this.rate = refillPerSecond;
    this.tokens = capacity;
    this.last = null;
  }

  _advance(nowMs) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite number');
    if (this.last === null) { this.last = nowMs; return; }
    if (nowMs > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + ((nowMs - this.last) / 1000) * this.rate);
      this.last = nowMs;
    }
  }

  tryTake(nowMs, n = 1) {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
    this._advance(nowMs);
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }

  available(nowMs) {
    this._advance(nowMs);
    return this.tokens;
  }
}

module.exports = { TokenBucket };
