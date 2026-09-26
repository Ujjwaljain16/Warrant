'use strict';

async function pool(items, worker, limit) {
  // Validate arguments
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker must be a function');
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('limit must be a positive integer');
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  let activeCount = 0;
  let error = null;
  let resolvePromise;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const startJob = async () => {
    if (error) return;
    if (nextIndex >= items.length) {
      if (activeCount === 0 && !error) {
        resolvePromise(results);
      }
      return;
    }

    const currentIndex = nextIndex++;
    activeCount++;

    try {
      const result = await Promise.resolve(worker(items[currentIndex], currentIndex));
      if (!error) {
        results[currentIndex] = result;
      }
    } catch (err) {
      if (!error) {
        error = err;
        rejectPromise(err);
      }
    } finally {
      activeCount--;
      if (!error) {
        startJob();
      }
    }
  };

  // Start initial jobs up to the limit
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    startJob();
  }

  // If no items, resolve immediately
  if (items.length === 0) {
    resolvePromise(results);
  }

  return promise;
}

module.exports = { pool };
