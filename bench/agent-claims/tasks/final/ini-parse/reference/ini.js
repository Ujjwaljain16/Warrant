'use strict';

function syntaxError(message, line) {
  const error = new SyntaxError(`line ${line}: ${message}`);
  error.line = line;
  return error;
}

function parseIni(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const root = Object.create(null);
  let current = root;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) return;
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) throw syntaxError('unterminated section header', lineNo);
      const name = line.slice(1, -1).trim();
      if (name === '') throw syntaxError('empty section name', lineNo);
      if (!Object.hasOwn(root, name) || typeof root[name] !== 'object') root[name] = Object.create(null);
      current = root[name];
      return;
    }
    const eq = line.indexOf('=');
    if (eq === -1) throw syntaxError('expected key = value', lineNo);
    const key = line.slice(0, eq).trim();
    if (key === '') throw syntaxError('empty key', lineNo);
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    current[key] = value;
  });
  return root;
}

module.exports = { parseIni };
