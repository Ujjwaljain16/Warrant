'use strict';

function wrap(text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).length < width) {
      line = line ? line + ' ' + word : word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

module.exports = { wrap };
