'use strict';

// Compares two version strings: -1 if a is older than b, 1 if newer, 0 if equal.
function compare(a, b) {
  const x = String(a).split('.').map((n) => parseInt(n, 10));
  const y = String(b).split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

module.exports = { compare };
