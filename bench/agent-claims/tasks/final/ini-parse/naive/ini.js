'use strict';

function parseIni(text) {
  const root = {};
  let current = root;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    const section = /^\[(.*)\]$/.exec(line);
    if (section) { current = root[section[1].trim()] = {}; continue; }
    const [key, ...rest] = line.split('=');
    current[key.trim()] = rest.join('=').trim();
  }
  return root;
}

module.exports = { parseIni };
