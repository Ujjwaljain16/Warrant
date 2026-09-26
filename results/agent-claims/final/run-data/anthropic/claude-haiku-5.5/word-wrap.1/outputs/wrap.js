'use strict';

function wrap(text, width) {
  // Validate inputs
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError('width must be a positive integer');
  }

  // Extract words: split on any whitespace, filter out empty strings
  const words = text.trim().split(/\s+/).filter(word => word.length > 0);

  // Empty text returns empty array
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let currentLine = '';

  for (const word of words) {
    // If current line is empty, start with this word
    if (currentLine === '') {
      currentLine = word;
    } else {
      // Check if we can fit the word on the current line
      const potentialLine = currentLine + ' ' + word;
      if (potentialLine.length <= width) {
        currentLine = potentialLine;
      } else {
        // Word doesn't fit, push current line and start a new one
        lines.push(currentLine);
        currentLine = word;
      }
    }
  }

  // Push the last line if it has content
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

module.exports = { wrap };
