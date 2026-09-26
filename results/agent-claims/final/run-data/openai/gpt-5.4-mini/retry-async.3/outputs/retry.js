'use strict';

async function retry(_fn, _options) {
  if (typeof _fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  const options = _options || {};
  let retries = options.retries;
  let delayMs = options.delayMs;
  let factor = options.factor;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (typeof retries === 'undefined') {
    retries = 3;
  } else {
    retries = Number(retries);
    if (!Number.isInteger(retries) || retries < 0) {
      throw new RangeError('retries must be a non-negative integer');
    }
  }

  if (typeof delayMs === 'undefined') {
    delayMs = 100;
  } else {
    delayMs = Number(delayMs);
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('delayMs must be a finite number of at least 0');
    }
  }

  if (typeof factor === 'undefined') {
    factor = 2;
  } else {
    factor = Number(factor);
    if (!Number.isFinite(factor) || factor < 1) {
      throw new RangeError('factor must be a finite number of at least 1');
    }
  }

  const maxAttempts = retries + 1;

  async function attempt(attemptNumber) {
    try {
      const result = _fn(attemptNumber);
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    } catch (error) {
      if (attemptNumber === maxAttempts) {
        throw error;
      }
      const waitMs = Math.round(delayMs * Math.pow(factor, attemptNumber - 1));
      await sleep(waitMs);
      return attempt(attemptNumber + 1);
    }
  }

  return attempt(1);
}

module.exports = { retry };