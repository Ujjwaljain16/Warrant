'use strict';

function parseIni(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseIni expects a string');
  }

  const result = Object.create(null);
  let current = result;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();

    if (line === '' || line[0] === ';' || line[0] === '#') {
      continue;
    }

    if (line[0] === '[') {
      if (line[line.length - 1] !== ']') {
        throw syntaxError('section header is missing "]"', lineNo);
      }
      const name = line.slice(1, -1).trim();
      if (name === '') {
        throw syntaxError('empty section name', lineNo);
      }
      const existing = result[name];
      if (existing !== undefined && typeof existing === 'object') {
        current = existing;
      } else {
        current = Object.create(null);
        result[name] = current;
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      throw syntaxError('expected "key = value" or "[section]"', lineNo);
    }

    const key = line.slice(0, eq).trim();
    if (key === '') {
      throw syntaxError('empty key', lineNo);
    }

    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }

    current[key] = value;
  }

  return result;
}

function syntaxError(message, line) {
  const err = new SyntaxError(`line ${line}: ${message}`);
  err.line = line;
  return err;
}

module.exports = { parseIni };
