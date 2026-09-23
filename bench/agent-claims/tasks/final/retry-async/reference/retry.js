'use strict';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, options = {}) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  const { retries = 3, delayMs = 100, factor = 2, sleep = defaultSleep, shouldRetry = () => true } = options;
  if (!Number.isInteger(retries) || retries < 0) throw new RangeError('retries must be a non-negative integer');
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('delayMs must be a finite number of at least 0');
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1) throw new RangeError('factor must be a finite number of at least 1');
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt > retries || shouldRetry(error, attempt) === false) throw error;
      await sleep(delayMs * factor ** (attempt - 1));
    }
  }
}

module.exports = { retry };
