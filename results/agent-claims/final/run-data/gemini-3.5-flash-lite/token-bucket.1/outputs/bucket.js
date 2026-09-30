'use strict';

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    if (
      typeof capacity !== 'number' ||
      !Number.isFinite(capacity) ||
      capacity <= 0 ||
      typeof refillPerSecond !== 'number' ||
      !Number.isFinite(refillPerSecond) ||
      refillPerSecond <= 0
    ) {
      throw new RangeError('Capacity and refillPerSecond must be finite numbers greater than 0');
    }

    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.lastTime = null;
  }

  _validateNowMs(nowMs) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }
  }

  _refill(nowMs) {
    this._validateNowMs(nowMs);
    if (this.lastTime === null) {
      this.lastTime = nowMs;
      return;
    }

    if (nowMs > this.lastTime) {
      const elapsedMs = nowMs - this.lastTime;
      const addedTokens = (elapsedMs / 1000) * this.refillPerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + addedTokens);
      this.lastTime = nowMs;
    }
  }

  tryTake(nowMs, n = 1) {
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n <= 0
    ) {
      throw new RangeError('n must be a positive integer');
    }

    this._refill(nowMs);

    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  available(nowMs) {
    this._refill(nowMs);
    return this.tokens;
  }
}

module.exports = { TokenBucket };
