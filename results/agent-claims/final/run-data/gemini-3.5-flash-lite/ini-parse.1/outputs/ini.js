'use strict';

function parseIni(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Expected a string');
  }

  const result = Object.create(null);
  let currentSection = result;

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i].trim();

    if (line === '' || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('[')) {
      if (!line.endsWith(']')) {
        const err = new SyntaxError(`Missing closing bracket at line ${lineNumber}`);
        err.line = lineNumber;
        throw err;
      }
      const sectionName = line.slice(1, -1).trim();
      if (sectionName === '') {
        const err = new SyntaxError(`Empty section name at line ${lineNumber}`);
        err.line = lineNumber;
        throw err;
      }

      if (!(sectionName in result) || typeof result[sectionName] !== 'object' || result[sectionName] === null) {
        result[sectionName] = Object.create(null);
      }
      currentSection = result[sectionName];
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      const err = new SyntaxError(`Invalid line at line ${lineNumber}`);
      err.line = lineNumber;
      throw err;
    }

    const key = line.slice(0, eqIndex).trim();
    if (key === '') {
      const err = new SyntaxError(`Empty key at line ${lineNumber}`);
      err.line = lineNumber;
      throw err;
    }

    let value = line.slice(eqIndex + 1).trim();

    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    currentSection[key] = value;
  }

  return result;
}

module.exports = { parseIni };
