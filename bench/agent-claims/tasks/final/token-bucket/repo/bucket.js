'use strict';

class TokenBucket {
  constructor(_capacity, _refillPerSecond) {
    throw new Error('not implemented');
  }

  tryTake(_nowMs, _n = 1) { throw new Error('not implemented'); }
  available(_nowMs) { throw new Error('not implemented'); }
}

module.exports = { TokenBucket };
