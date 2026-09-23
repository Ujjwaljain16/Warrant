'use strict';

function rotate(items, k) {
  const n = k % items.length;
  return items.slice(items.length - n).concat(items.slice(0, items.length - n));
}

module.exports = { rotate };
