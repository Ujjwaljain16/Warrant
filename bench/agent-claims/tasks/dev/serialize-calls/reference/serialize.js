'use strict';

function serialize(fn) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  let tail = Promise.resolve();
  return function serialized(...args) {
    const result = tail.then(() => fn.apply(this, args));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

module.exports = { serialize };
