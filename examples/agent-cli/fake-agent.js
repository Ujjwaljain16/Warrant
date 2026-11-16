'use strict';
// Two scripted stand-ins for a coding agent, so the example runs offline and deterministically. Both write slugify.js and both
// report success. Only one is right.
//   node fake-agent.js careful    handles accents, separators, ends and non-strings
//   node fake-agent.js hasty      passes the visible tests and stops there
const fs = require('node:fs');

const CAREFUL = `'use strict';
function slugify(text) {
  if (typeof text !== 'string') throw new TypeError('slugify expects a string');
  return text.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
module.exports = { slugify };
`;

const HASTY = `'use strict';
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ /g, '-');
}
module.exports = { slugify };
`;

const mode = process.argv[2];
if (mode !== 'careful' && mode !== 'hasty') {
  process.stderr.write('usage: node fake-agent.js careful|hasty\n');
  process.exit(2);
}
fs.writeFileSync('slugify.js', mode === 'careful' ? CAREFUL : HASTY);
process.stdout.write('Done. slugify.js is written and the tests pass.\n');
