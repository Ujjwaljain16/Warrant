'use strict';

function uniqueBy(items, keyFn = (x) => x) {
  const keys = items.map(keyFn);
  return items.filter((_item, i) => keys.indexOf(keys[i]) === i);
}

module.exports = { uniqueBy };
