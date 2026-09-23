'use strict';

async function pool(items, worker, limit) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  if (items.length === 0) return [];
  const results = new Array(items.length);
  return new Promise((resolve, reject) => {
    let next = 0;
    let active = 0;
    let finished = 0;
    let failed = false;
    const launch = () => {
      while (!failed && active < limit && next < items.length) {
        const index = next++;
        active++;
        let promise;
        try { promise = Promise.resolve(worker(items[index], index)); } catch (error) { promise = Promise.reject(error); }
        promise.then((value) => {
          results[index] = value;
          active--;
          finished++;
          if (finished === items.length) resolve(results);
          else launch();
        }, (error) => {
          if (!failed) { failed = true; reject(error); }
        });
      }
    };
    launch();
  });
}

module.exports = { pool };
