'use strict';

// Splits an array into consecutive pieces of at most `size` items.
function chunk(items, size) {
  const step = Math.max(1, size);
  const out = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

module.exports = { chunk };
