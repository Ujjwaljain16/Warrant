'use strict';

// Compares two version strings: -1 if a is older than b, 1 if newer, 0 if equal.
function compare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

module.exports = { compare };
