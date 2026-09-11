'use strict';

// Splits one line of CSV text into its fields.
function parseLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { fields.push(field); field = ''; } else field += ch;
  }
  fields.push(field);
  return fields;
}

module.exports = { parseLine };
