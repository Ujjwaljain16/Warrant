'use strict';

async function pool(items, worker, limit) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker must be a function');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer');
  }

  const total = items.length;
  if (total === 0) {
    return [];
  }

  const results = new Array(total);
  let nextIndex = 0;
  let finished = 0;
  let inFlight = 0;
  let failed = false;

  return new Promise((resolve, reject) => {
    const launch = () => {
      while (!failed && inFlight < limit && nextIndex < total) {
        const i = nextIndex++;
        inFlight++;

        let job;
        try {
          job = Promise.resolve(worker(items[i], i));
        } catch (err) {
          job = Promise.reject(err);
        }

        job.then(
          (value) => {
            if (failed) return;
            results[i] = value;
            inFlight--;
            finished++;
            if (finished === total) {
              resolve(results);
            } else {
              launch();
            }
          },
          (err) => {
            if (failed) return;
            failed = true;
            reject(err);
          }
        );
      }
    };

    launch();
  });
}

module.exports = { pool };
