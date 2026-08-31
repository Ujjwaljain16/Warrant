'use strict';

// Split items into groups of `size`.
function chunk(items, size) {
  const groups = [];
  for (let i = 0; i + size <= items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

module.exports = { chunk };
