'use strict';

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a finite number greater than 0');
    }
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
      throw new RangeError('refillPerSecond must be a finite number greater than 0');
    }
    this._capacity = capacity;
    this._refillPerSecond = refillPerSecond;
    this._tokens = capacity;
    this._lastMs = null;
  }

  // Brings the bucket up to date at nowMs. The clock never runs backwards:
  // an earlier time causes no refill and leaves the latest time unchanged.
  _advance(nowMs) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }
    if (this._lastMs === null) {
      this._lastMs = nowMs;
      return;
    }
    if (nowMs > this._lastMs) {
      const elapsedMs = nowMs - this._lastMs;
      this._tokens = Math.min(
        this._capacity,
        this._tokens + (elapsedMs * this._refillPerSecond) / 1000
      );
      this._lastMs = nowMs;
    }
  }

  tryTake(nowMs, n = 1) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError('n must be a positive integer');
    }
    this._advance(nowMs);
    if (this._tokens >= n) {
      this._tokens -= n;
      return true;
    }
    return false;
  }

  available(nowMs) {
    this._advance(nowMs);
    return this._tokens;
  }
}

module.exports = { TokenBucket };
