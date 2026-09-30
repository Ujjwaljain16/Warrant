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

  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    let activeCount = 0;
    let completedCount = 0;
    let hasFailed = false;

    function runNext() {
      if (hasFailed) return;

      if (nextIndex === items.length) {
        if (completedCount === items.length) {
          resolve(results);
        }
        return;
      }

      while (activeCount < limit && nextIndex < items.length && !hasFailed) {
        const currentIndex = nextIndex++;
        activeCount++;

        Promise.resolve()
          .then(() => worker(items[currentIndex], currentIndex))
          .then(
            (result) => {
              if (hasFailed) return;
              results[currentIndex] = result;
              completedCount++;
              activeCount--;
              runNext();
            },
            (error) => {
              if (hasFailed) return;
              hasFailed = true;
              reject(error);
            }
          );
      }
    }

    runNext();
  });
}

module.exports = { pool };
