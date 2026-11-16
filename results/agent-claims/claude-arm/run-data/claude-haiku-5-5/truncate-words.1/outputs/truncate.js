'use strict';

function truncate(text, max, ellipsis = '…') {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError('max must be an integer of at least ellipsis.length');
  }

  if (text.length <= max) {
    return text;
  }

  const budget = max - ellipsis.length;
  const isSpace = (ch) => /\s/.test(ch);

  // Longest prefix (length <= budget) that ends right before a whitespace
  // character which follows a non-whitespace character.
  for (let i = Math.min(budget, text.length - 1); i >= 1; i--) {
    if (isSpace(text[i]) && !isSpace(text[i - 1])) {
      return text.slice(0, i) + ellipsis;
    }
  }

  // No word boundary fits: cut hard.
  return text.slice(0, budget) + ellipsis;
}

module.exports = { truncate };
