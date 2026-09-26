'use strict';

function truncate(text, max, ellipsis = '…') {
  // Validate arguments
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof ellipsis !== 'string') {
    throw new TypeError('ellipsis must be a string');
  }
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError('max must be an integer at least ellipsis.length');
  }

  // If text is short enough, return unchanged
  if (text.length <= max) {
    return text;
  }

  // Calculate the maximum prefix length
  const maxPrefixLength = max - ellipsis.length;

  // Find the longest prefix ending at a word boundary
  // A word boundary is right before whitespace that follows non-whitespace
  let prefixLength = maxPrefixLength;
  let found = false;

  // Search backwards from maxPrefixLength to find a word boundary
  for (let i = maxPrefixLength; i >= 0; i--) {
    // Check if position i is a valid word boundary:
    // - text[i] should be a non-whitespace character (or start of string)
    // - text[i+1] should be whitespace (or end of string)
    if (i === text.length) {
      continue;
    }
    if (text[i + 1] === undefined || /\s/.test(text[i + 1])) {
      // Check if text[i] is non-whitespace (or i === 0)
      if (i === 0 || !/\s/.test(text[i])) {
        prefixLength = i + 1;
        found = true;
        break;
      }
    }
  }

  // If no word boundary found, use hard cut
  if (!found) {
    return text.slice(0, maxPrefixLength) + ellipsis;
  }

  return text.slice(0, prefixLength) + ellipsis;
}

module.exports = { truncate };
