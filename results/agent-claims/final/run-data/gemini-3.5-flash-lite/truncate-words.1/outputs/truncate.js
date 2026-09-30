'use strict';

function truncate(text, max, ellipsis = '\u2026') {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError('max must be an integer at least as long as ellipsis.length');
  }

  if (text.length <= max) {
    return text;
  }

  const targetMaxPrefixLen = max - ellipsis.length;

  let bestLen = -1;
  for (let l = targetMaxPrefixLen; l >= 1; l--) {
    const prevChar = text[l - 1];
    const currChar = text[l];
    if (prevChar !== undefined && currChar !== undefined) {
      if (!isWhitespace(prevChar) && isWhitespace(currChar)) {
        bestLen = l;
        break;
      }
    }
  }

  if (bestLen !== -1) {
    return text.slice(0, bestLen) + ellipsis;
  }

  return text.slice(0, targetMaxPrefixLen) + ellipsis;
}

function isWhitespace(char) {
  return /^\s$/.test(char);
}

module.exports = { truncate };
