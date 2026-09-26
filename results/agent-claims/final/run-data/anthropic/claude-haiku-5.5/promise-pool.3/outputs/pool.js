'use strict';

async function pool(items, worker, limit) {
  // Validate arguments
  if (!Array.isArray(items)) {
    return Promise.reject(new TypeError('items must be an array'));
  }
  if (typeof worker !== 'function') {
    return Promise.reject(new TypeError('worker must be a function'));
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return Promise.reject(new RangeError('limit must be a positive integer'));
  }

  // Handle empty array
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  let running = 0;
  let error = null;
  let resolved = false;

  return new Promise((resolve, reject) => {
    const startJob = () => {
      // If we already have an error, stop starting new jobs
      if (error) {
        return;
      }

      // If no more items to process, resolve if all jobs are done
      if (nextIndex >= items.length) {
        if (running === 0 && !resolved) {
          resolved = true;
          resolve(results);
        }
        return;
      }

      // Start a job
      const index = nextIndex;
      nextIndex++;
      running++;

      Promise.resolve(worker(items[index], index))
        .then((result) => {
          results[index] = result;
          running--;

          if (error) {
            // Error already occurred, don't start more jobs
            if (running === 0 && !resolved) {
              resolved = true;
              reject(error);
            }
            return;
          }

          // Try to start the next job
          if (nextIndex < items.length) {
            startJob();
          } else if (running === 0 && !resolved) {
            resolved = true;
            resolve(results);
          }
        })
        .catch((err) => {
          running--;
          if (!error) {
            error = err;
            if (running === 0 && !resolved) {
              resolved = true;
              reject(error);
            }
          }
        });
    };

    // Start initial batch of jobs
    const initialJobs = Math.min(limit, items.length);
    for (let i = 0; i < initialJobs; i++) {
      startJob();
    }
  });
}

module.exports = { pool };
