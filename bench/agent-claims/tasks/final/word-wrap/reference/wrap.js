'use strict';

function wrap(text, width) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(width) || width < 1) throw new RangeError('width must be a positive integer');
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line !== '') lines.push(line);
  return lines;
}

module.exports = { wrap };
