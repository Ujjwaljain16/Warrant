'use strict';

function wrap(text, width) {
  // Validate input types
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
    throw new RangeError('width must be a positive integer');
  }

  // Split text into words, treating any run of whitespace as a single separator
  const words = text.trim().split(/\s+/).filter(word => word.length > 0);

  // Handle empty text
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let line = '';

  for (const word of words) {
    // Try to add word to current line
    const testLine = line ? line + ' ' + word : word;
    
    if (testLine.length <= width) {
      // Word fits on current line
      line = testLine;
    } else {
      // Word doesn't fit; push current line if it exists
      if (line) {
        lines.push(line);
      }
      // Start new line with the word
      line = word;
    }
  }

  // Push final line if it exists
  if (line) {
    lines.push(line);
  }

  return lines;
}

module.exports = { wrap };
