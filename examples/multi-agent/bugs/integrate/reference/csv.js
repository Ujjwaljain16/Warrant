'use strict';

// Splits one line of CSV text into its fields.
function parseLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(field); field = ''; } else field += ch;
  }
  if (quoted) throw new SyntaxError('unterminated quote');
  fields.push(field);
  return fields;
}

module.exports = { parseLine };
