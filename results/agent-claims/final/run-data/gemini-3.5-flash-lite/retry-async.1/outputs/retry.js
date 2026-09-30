'use strict';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }

  const retries = options.retries !== undefined ? options.retries : 3;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }

  const delayMs = options.delayMs !== undefined ? options.delayMs : 100;
  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite number of at least 0');
  }

  const factor = options.factor !== undefined ? options.factor : 2;
  if (typeof factor !== 'number' || Number.isNaN(factor) || !Number.isFinite(factor) || factor < 1) {
    throw new RangeError('factor must be a finite number of at least 1');
  }

  const sleep = options.sleep !== undefined ? options.sleep : defaultSleep;
  if (typeof sleep !== 'function') {
    throw new TypeError('sleep must be a function');
  }

  const shouldRetry = options.shouldRetry !== undefined ? options.shouldRetry : () => true;
  if (typeof shouldRetry !== 'function') {
    throw new TypeError('shouldRetry must be a function');
  }

  const totalAttempts = retries + 1;
  let lastError;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === totalAttempts) {
        throw lastError;
      }
      if (shouldRetry(err, attempt) === false) {
        throw lastError;
      }
      const waitTime = delayMs * Math.pow(factor, attempt - 1);
      await sleep(waitTime);
    }
  }

  throw lastError;
}

module.exports = { retry };
