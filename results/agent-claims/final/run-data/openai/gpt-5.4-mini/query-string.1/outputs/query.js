'use strict';

function parseQuery(_str) {
  if (typeof _str !== 'string') {
    throw new TypeError('parseQuery expects a string argument');
  }

  const str = _str.startsWith('?') ? _str.slice(1) : _str;

  const pairs = str.split('&').filter(Boolean);

  const result = Object.create(null);
  const seen = new Set();

  for (let pair of pairs) {
    const eqIndex = pair.indexOf('=');
    let key, value;
    if (eqIndex === -1) {
      key = pair;
      value = '';
    } else if (eqIndex === 0) {
      key = '';
      value = pair.slice(1);
    } else {
      key = pair.slice(0, eqIndex);
      value = pair.slice(eqIndex + 1);
    }

    if (key === '') continue;

    const decodedKey = decodeURIComponent(key);
    const decodedValue = decodeURIComponent(value);

    if (result[decodedKey] === undefined) {
      result[decodedKey] = decodedValue;
      seen.add(decodedKey);
    } else if (seen.has(decodedKey)) {
      result[decodedKey] = [result[decodedKey]];
      result[decodedKey].push(decodedValue);
      seen.add(decodedKey);
    } else {
      result[decodedKey].push(decodedValue);
    }
  }

  return result;
}

module.exports = { parseQuery };
