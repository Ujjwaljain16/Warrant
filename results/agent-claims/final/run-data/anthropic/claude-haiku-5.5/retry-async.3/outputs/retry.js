'use strict';

const DEFAULT_SLEEP = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, options = {}) {
  // Validate fn
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }

  // Extract and validate options
  const retries = options.retries !== undefined ? options.retries : 3;
  const delayMs = options.delayMs !== undefined ? options.delayMs : 100;
  const factor = options.factor !== undefined ? options.factor : 2;
  const sleep = options.sleep !== undefined ? options.sleep : DEFAULT_SLEEP;
  const shouldRetry = options.shouldRetry !== undefined ? options.shouldRetry : () => true;

  // Validate retries
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }

  // Validate delayMs
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite number >= 0');
  }

  // Validate factor
  if (!Number.isFinite(factor) || factor < 1) {
    throw new RangeError('factor must be a finite number >= 1');
  }

  const maxAttempts = retries + 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Call fn with the attempt number
      const result = await fn(attempt);
      return result;
    } catch (error) {
      lastError = error;

      // If this is the last attempt, reject immediately without waiting
      if (attempt === maxAttempts) {
        throw lastError;
      }

      // Check if we should retry
      if (!shouldRetry(error, attempt)) {
        throw lastError;
      }

      // Calculate the wait time: delayMs * factor^(attempt-1)
      const waitTime = delayMs * Math.pow(factor, attempt - 1);
      await sleep(waitTime);
    }
  }
}

module.exports = { retry };
