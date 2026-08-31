'use strict';

// Split items into groups of `size`; the last group may be shorter.
function chunk(items, size) {
  if (!size) return [];
  const groups = [];
  while (items.length) groups.push(items.splice(0, size));
  return groups;
}

module.exports = { chunk };
