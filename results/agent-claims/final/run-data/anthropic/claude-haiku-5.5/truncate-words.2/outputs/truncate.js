'use strict';

function truncate(text, max, ellipsis = '…') {
  // Validate types
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }

  // Validate max
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError('max must be an integer at least ellipsis.length');
  }

  // If text fits, return unchanged
  if (text.length <= max) {
    return text;
  }

  // Text is too long, need to truncate
  const maxPrefixLength = max - ellipsis.length;

  // Find the longest prefix that ends at a word boundary
  // A word boundary is right before a whitespace that follows non-whitespace
  let boundaryIndex = -1;

  for (let i = maxPrefixLength; i > 0; i--) {
    const char = text[i];
    // Check if current position is a whitespace and previous is non-whitespace
    if (/\s/.test(char) && i > 0 && !/\s/.test(text[i - 1])) {
      boundaryIndex = i;
      break;
    }
  }

  // If we found a word boundary, use it
  if (boundaryIndex > 0) {
    return text.slice(0, boundaryIndex) + ellipsis;
  }

  // No word boundary found, cut hard
  return text.slice(0, maxPrefixLength) + ellipsis;
}

module.exports = { truncate };
