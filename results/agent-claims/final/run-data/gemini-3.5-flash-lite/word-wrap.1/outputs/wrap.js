'use strict';

function wrap(text, width) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
    throw new RangeError('width must be a positive integer');
  }

  const words = text.trim() === '' ? [] : text.trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) {
    return [];
  }

  const lines = [];
  let line = '';

  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ' ' + word;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line !== '') {
    lines.push(line);
  }

  return lines;
}

module.exports = { wrap };
