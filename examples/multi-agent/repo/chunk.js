'use strict';

// Splits an array into consecutive pieces of at most `size` items.
function chunk(items, size) {
  const count = Math.floor(items.length / size);
  const out = [];
  for (let i = 0; i < count && i < items.length; i++) out.push(items.slice(i * size, (i + 1) * size));
  return out;
}

module.exports = { chunk };
