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
      this.tokens = available - n;
      this.lastRefillTime = nowMs;
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
    
    if (nowMs < this.lastRefillTime) {
      return this.tokens;
    }
    
    const elapsedMs = nowMs - this.lastRefillTime;
    const elapsedSeconds = elapsedMs / 1000;
    const tokensToAdd = elapsedSeconds * this.refillPerSecond;
    const newTokens = Math.min(this.tokens + tokensToAdd, this.capacity);
    
    this.tokens = newTokens;
    this.lastRefillTime = nowMs;
    
    return this.tokens;
  }
}

module.exports = { TokenBucket };
