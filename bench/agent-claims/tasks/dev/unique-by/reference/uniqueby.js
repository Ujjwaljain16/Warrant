'use strict';

function uniqueBy(items, keyFn) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (keyFn !== undefined && typeof keyFn !== 'function') throw new TypeError('keyFn must be a function');
  const seen = new Set();
  const out = [];
  items.forEach((item, index) => {
    const key = keyFn === undefined ? item : keyFn(item, index);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  });
  return out;
}

module.exports = { uniqueBy };
