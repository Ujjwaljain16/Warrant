'use strict';

function flatten(items, depth = 1) {
  const out = [];
  for (const item of items) {
    if (Array.isArray(item) && depth > 0) out.push(...flatten(item, depth));
    else out.push(item);
  }
  return out;
}

module.exports = { flatten };
