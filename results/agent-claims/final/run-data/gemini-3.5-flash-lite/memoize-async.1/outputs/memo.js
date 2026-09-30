'use strict';

function memoizeAsync(fn, keyFn) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (keyFn !== undefined && typeof keyFn !== 'function') {
    throw new TypeError('keyFn must be a function');
  }

  const cache = new Map();
  const inProgress = new Map();

  return function (...args) {
    const key = keyFn ? keyFn(...args) : args[0];

    if (cache.has(key)) {
      return Promise.resolve(cache.get(key));
    }

    if (inProgress.has(key)) {
      return inProgress.get(key);
    }

    let promise;
    try {
      promise = Promise.resolve().then(() => fn(...args));
    } catch (err) {
      promise = Promise.reject(err);
    }

    inProgress.set(key, promise);

    return promise.then(
      (result) => {
        inProgress.delete(key);
        cache.set(key, result);
        return result;
      },
      (err) => {
        inProgress.delete(key);
        throw err;
      }
    );
  };
}

module.exports = { memoizeAsync };
