'use strict';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, options) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }

  const opts = options || {};
  const {
    retries = 3,
    delayMs = 100,
    factor = 2,
    sleep = defaultSleep,
    shouldRetry = () => true,
  } = opts;

  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite number >= 0');
  }
  if (!Number.isFinite(factor) || factor < 1) {
    throw new RangeError('factor must be a finite number >= 1');
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt > retries) {
        throw error;
      }
      if (!(await shouldRetry(error, attempt))) {
        throw error;
      }
      await sleep(delayMs * factor ** (attempt - 1));
    }
  }
}

module.exports = { retry };
