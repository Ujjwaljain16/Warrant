'use strict';

async function retry(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }

  const retries = options.retries !== undefined ? options.retries : 3;
  const delayMs = options.delayMs !== undefined ? options.delayMs : 100;
  const factor = options.factor !== undefined ? options.factor : 2;
  const sleep = options.sleep || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  const shouldRetry = options.shouldRetry || (() => true);

  // Validate arguments
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite number of at least 0');
  }
  if (!Number.isFinite(factor) || factor < 1) {
    throw new RangeError('factor must be a finite number of at least 1');
  }

  let lastError;
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error, attempt)) {
        throw error;
      }

      // If this is the last attempt, don't wait
      if (attempt === maxAttempts) {
        throw error;
      }

      // Calculate wait time: delayMs * factor^(k-1) where k is the failure count (1-indexed)
      const waitTime = delayMs * Math.pow(factor, attempt - 1);
      await sleep(waitTime);
    }
  }

  throw lastError;
}

module.exports = { retry };
