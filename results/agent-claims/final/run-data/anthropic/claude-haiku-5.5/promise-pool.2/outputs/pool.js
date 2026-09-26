'use strict';

async function pool(items, worker, limit) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker must be a function');
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('limit must be a positive integer');
  }

  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  let activeCount = 0;
  let errorOccurred = null;
  let resolveMain;
  let rejectMain;

  const mainPromise = new Promise((resolve, reject) => {
    resolveMain = resolve;
    rejectMain = reject;
  });

  async function runWorker(index) {
    try {
      const result = await Promise.resolve(worker(items[index], index));
      results[index] = result;
    } catch (err) {
      if (!errorOccurred) {
        errorOccurred = err;
      }
    }
  }

  function startNextJob() {
    if (errorOccurred || nextIndex >= items.length) {
      activeCount--;
      if (activeCount === 0) {
        if (errorOccurred) {
          rejectMain(errorOccurred);
        } else {
          resolveMain(results);
        }
      }
      return;
    }

    const currentIndex = nextIndex++;
    runWorker(currentIndex).then(() => {
      startNextJob();
    });
  }

  for (let i = 0; i < Math.min(limit, items.length); i++) {
    activeCount++;
    startNextJob();
  }

  return mainPromise;
}

module.exports = { pool };
