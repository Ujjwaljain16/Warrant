'use strict';

function parseCsvLine(line) {
  if (typeof line !== 'string') throw new TypeError('line must be a string');
  const out = [];
  const n = line.length;
  let i = 0;
  for (;;) {
    let field = '';
    if (line[i] === '"') {
      i++;
      for (;;) {
        if (i >= n) throw new SyntaxError('unterminated quoted field');
        const c = line[i];
        if (c === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++;
          break;
        }
        field += c;
        i++;
      }
      if (i < n && line[i] !== ',') throw new SyntaxError('unexpected text after closing quote');
    } else {
      while (i < n && line[i] !== ',') { field += line[i]; i++; }
    }
    out.push(field);
    if (i >= n) return out;
    i++;
  }
}

module.exports = { parseCsvLine };
