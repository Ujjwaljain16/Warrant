'use strict';

function truncate(text, max, ellipsis = '…') {
  // Validate types
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }
  if (!Number.isInteger(max)) {
    throw new RangeError('max must be an integer');
  }
  if (max < ellipsis.length) {
    throw new RangeError('max must be at least ellipsis.length');
  }

  // If text fits, return unchanged
  if (text.length <= max) {
    return text;
  }

  // Need to truncate
  const maxPrefixLength = max - ellipsis.length;

  // Try to find a word boundary (whitespace after non-whitespace)
  // Look backwards from maxPrefixLength to find where to break
  let breakPoint = maxPrefixLength;
  
  // Search backwards for a whitespace boundary
  for (let i = maxPrefixLength; i > 0; i--) {
    // Check if position i is a whitespace preceded by non-whitespace
    if (/\s/.test(text[i]) && !/\s/.test(text[i - 1])) {
      breakPoint = i;
      break;
    }
  }

  // If we found a boundary different from maxPrefixLength, use it
  if (breakPoint < maxPrefixLength) {
    // We found a word boundary; trim trailing whitespace from prefix
    return text.slice(0, breakPoint).trimEnd() + ellipsis;
  }

  // No word boundary found, cut hard
  return text.slice(0, maxPrefixLength) + ellipsis;
}

module.exports = { truncate };
