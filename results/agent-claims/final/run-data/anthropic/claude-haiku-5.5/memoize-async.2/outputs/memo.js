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

    // If a call with this key is already pending, return that promise
    if (pending.has(key)) {
      return pending.get(key);
    }

    // If we have a cached value, return it
    if (cache.has(key)) {
      return Promise.resolve(cache.get(key));
    }

    // Create a new promise for this call
    const promise = Promise.resolve()
      .then(() => fn(...args))
      .then(
        (result) => {
          // Cache the result and clean up pending
          cache.set(key, result);
          pending.delete(key);
          return result;
        },
        (error) => {
          // Don't cache the error, just clean up pending and rethrow
          pending.delete(key);
          throw error;
        }
      );

    // Store the pending promise
    pending.set(key, promise);

    return promise;
  };
}

module.exports = { memoizeAsync };
