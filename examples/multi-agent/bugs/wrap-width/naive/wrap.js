'use strict';

// Word-wraps text to lines of at most `width` characters.
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length + word.length + 1 <= width) line = line ? `${line} ${word}` : word;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

module.exports = { wrap };
