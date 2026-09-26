'use strict';

function memoizeAsync(fn, keyFn) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (keyFn !== undefined && typeof keyFn !== 'function') {
    throw new TypeError('keyFn must be a function if provided');
  }

  const cache = new Map();

  function memoizeAsyncInternal(...args) {
    const key = keyFn ? keyFn(...args) : args[0];
    const cached = cache.get(key);

    if (cached) {
      if (cached.pending) {
        return cached.promise;
      }
      if (cached.value !== undefined) {
        return Promise.resolve(cached.value);
      }
      if (cached.error !== undefined) {
        return Promise.reject(cached.error);
      }
      return cached.promise;
    }

    const promise = fn(...args);
    const entry = { promise };
    cache.set(key, entry);

    promise
      .then((value) => {
        entry.value = value;
        entry.error = undefined;
        return value;
      })
      .catch((err) => {
        entry.value = undefined;
        entry.error = err;
        throw err;
      });

    return promise;
  }

  return memoizeAsyncInternal;
}

module.exports = { memoizeAsync };