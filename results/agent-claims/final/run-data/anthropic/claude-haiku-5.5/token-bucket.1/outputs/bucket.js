'use strict';

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a finite number greater than 0');
    }
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
      throw new RangeError('refillPerSecond must be a finite number greater than 0');
    }
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.lastRefillTime = null;
  }

  tryTake(nowMs, n = 1) {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError('n must be a positive integer');
    }

    const available = this.available(nowMs);
    if (available >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  available(nowMs) {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }

    if (this.lastRefillTime === null) {
      this.lastRefillTime = nowMs;
      return this.tokens;
    }

    if (nowMs >= this.lastRefillTime) {
      const elapsed = nowMs - this.lastRefillTime;
      const tokensToAdd = (elapsed / 1000) * this.refillPerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTime = nowMs;
    }

    return this.tokens;
  }
}

module.exports = { TokenBucket };