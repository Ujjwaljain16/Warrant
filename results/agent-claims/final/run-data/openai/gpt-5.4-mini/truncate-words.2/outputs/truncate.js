'use strict';

function truncate(_text, _max, _ellipsis) {
  if (typeof _text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof _ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }
  if (typeof _max !== 'number' || !Number.isInteger(_max) || _max < _ellipsis.length) {
    throw new RangeError('max must be an integer >= ellipsis.length');
  }
  const text = String(_text);
  const max = _max;
  const ellipsis = _ellipsis;
  const len = text.length;
  if (len <= max) {
    return text;
  }
  if (max <= 0) {
    return ellipsis;
  }
  const ellLen = ellipsis.length;
  const maxWithEll = max - ellLen;
  if (maxWithEll <= 0) {
    return ellipsis;
  }
  if (maxWithEll >= len) {
    return text + ellipsis;
  }
  let prefixLen = maxWithEll;
  while (prefixLen > 0) {
    const lastChar = text[prefixLen - 1];
    if (lastChar !== ' ' && lastChar !== '	' && lastChar !== '
' && lastChar !== '') {
      prefixLen--;
      continue;
    }
    if (lastChar === ' ' || lastChar === '	' || lastChar === '
' || lastChar === '') {
      prefixLen--;
      break;
    }
    const prevChar = text[prefixLen - 2];
    if (prevChar === ' ' || prevChar === '	' || prevChar === '
' || prevChar === '') {
      prefixLen -= 2;
      break;
    }
    prefixLen--;
  }
  if (prefixLen === 0) {
    return text.substring(0, maxWithEll) + ellipsis;
  }
  return text.substring(0, prefixLen) + ellipsis;
}

module.exports = { truncate };