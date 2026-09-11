'use strict';

// Word-wraps text to lines of at most `width` characters (a longer single word keeps its own line).
function wrap(text, width) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(width) || width < 1) throw new RangeError('width must be an integer of at least 1');
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

module.exports = { wrap };
