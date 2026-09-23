'use strict';

function memoizeAsync(fn, keyFn) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  if (keyFn !== undefined && typeof keyFn !== 'function') throw new TypeError('keyFn must be a function');
  const cache = new Map();
  return function memoized(...args) {
    const key = keyFn ? keyFn(...args) : args[0];
    if (cache.has(key)) return cache.get(key);
    let promise;
    try { promise = Promise.resolve(fn.apply(this, args)); } catch (error) { promise = Promise.reject(error); }
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  };
}

module.exports = { memoizeAsync };
