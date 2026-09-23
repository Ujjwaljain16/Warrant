'use strict';

function memoizeAsync(fn, keyFn) {
  const cache = new Map();
  return async function memoized(...args) {
    const key = keyFn ? keyFn(...args) : args[0];
    if (cache.has(key)) return cache.get(key);
    const value = await fn.apply(this, args);
    cache.set(key, value);
    return value;
  };
}

module.exports = { memoizeAsync };
