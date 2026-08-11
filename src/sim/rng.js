'use strict';

// Stateless seeded randomness: unit(key) is a pure function of the string key, uniform in [0, 1).
// Fault fates are derived from (seed, task, attempt) keys rather than from a shared generator stream, so
// every policy meets identical fates for the same attempt regardless of how many other draws it made.
function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function unit(key) {
  // Two rounds mix short, similar keys ("a|1" vs "a|2") well.
  return hash32(`${hash32(key)}:${key}`) / 4294967296;
}

module.exports = Object.freeze({ hash32, unit });
