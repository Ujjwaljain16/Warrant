'use strict';

function memoizeAsync(fn, keyFn) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (keyFn !== undefined && typeof keyFn !== 'function') {
    throw new TypeError('keyFn must be a function when given');
  }

  // key -> promise for a pending or fulfilled call
  const cache = new Map();

  return function memoized(...args) {
    let key;
    try {
      key = keyFn ? keyFn(...args) : args[0];
    } catch (err) {
      return Promise.reject(err);
    }

    if (cache.has(key)) {
      return cache.get(key);
    }

    let p;
    try {
      p = Promise.resolve(fn(...args));
    } catch (err) {
      p = Promise.reject(err);
    }

    cache.set(key, p);
    p.catch(() => {
      // Do not cache rejections; the next call with this key retries.
      if (cache.get(key) === p) {
        cache.delete(key);
      }
    });

    return p;
  };
}

module.exports = { memoizeAsync };
