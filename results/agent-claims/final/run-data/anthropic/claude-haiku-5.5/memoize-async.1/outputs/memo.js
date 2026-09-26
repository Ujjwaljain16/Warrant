'use strict';

function memoizeAsync(fn, keyFn) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (keyFn !== undefined && typeof keyFn !== 'function') {
    throw new TypeError('keyFn must be a function');
  }

  const cache = new Map();
  const pending = new Map();

  return function (...args) {
    const key = keyFn ? keyFn(...args) : args[0];

    // If a promise for this key is already pending, return it
    if (pending.has(key)) {
      return pending.get(key);
    }

    // If a successful result is cached, return it
    if (cache.has(key)) {
      return Promise.resolve(cache.get(key));
    }

    // Call fn and cache the promise while pending
    const promise = Promise.resolve().then(() => fn(...args))
      .then(result => {
        cache.set(key, result);
        pending.delete(key);
        return result;
      })
      .catch(error => {
        pending.delete(key);
        throw error;
      });

    pending.set(key, promise);
    return promise;
  };
}

module.exports = { memoizeAsync };
