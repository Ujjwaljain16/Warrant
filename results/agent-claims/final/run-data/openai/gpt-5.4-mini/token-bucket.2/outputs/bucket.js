'use strict';

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    if (typeof capacity !== 'number' || typeof refillPerSecond !== 'number') {
      throw new TypeError('capacity and refillPerSecond must be numbers');
    }
    if (!Number.isFinite(capacity) || !Number.isFinite(refillPerSecond) || capacity <= 0 || refillPerSecond <= 0) {
      throw new RangeError('capacity and refillPerSecond must be finite numbers greater than 0');
    }
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.lastTime = null;
    this.tokens = capacity;
  }

  tryTake(nowMs, n = 1) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new RangeError('n must be a positive integer');
    }
    if (n > this.capacity) {
      return false;
    }

    let refilled = 0;
    if (this.lastTime !== null) {
      if (nowMs >= this.lastTime) {
        const elapsed = nowMs - this.lastTime;
        const tokensAdded = elapsed * this.refillPerSecond;
        refilled = tokensAdded;
        this.tokens = Math.min(this.tokens + refilled, this.capacity);
      }
      // else: nowMs < lastTime, no refill, lastTime unchanged
    }
    this.lastTime = nowMs;

    const availableNow = this.tokens;
    if (availableNow >= n) {
      this.tokens -= n;
      return true;
    } else {
      return false;
    }
  }

  available(nowMs) {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      throw new TypeError('nowMs must be a finite number');
    }
    let refilled = 0;
    if (this.lastTime !== null) {
      if (nowMs >= this.lastTime) {
        const elapsed = nowMs - this.lastTime;
        const tokensAdded = elapsed * this.refillPerSecond;
        refilled = tokensAdded;
      }
      // else: no refill
    }
    const currentTokens = this.tokens;
    return Math.min(currentTokens + refilled, this.capacity);
  }
}

module.exports = { TokenBucket };