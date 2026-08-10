'use strict';

// A clock is { now(): integer ms, setTimeout(fn, ms): handle, clearTimeout(handle) }.
// The engine only ever talks to this interface, so it runs unchanged on real time and on the
// deterministic virtual clock used by tests and benchmarks.
const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
});

function sleep(clock, ms) {
  return new Promise((resolve) => { clock.setTimeout(resolve, ms); });
}

module.exports = Object.freeze({ realClock, sleep });
