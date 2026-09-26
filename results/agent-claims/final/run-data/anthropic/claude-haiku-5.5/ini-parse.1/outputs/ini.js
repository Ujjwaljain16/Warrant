'use strict';

function parseIni(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const result = Object.create(null);
  let currentSection = result;
  let lineNumber = 0;

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (line === '' || line[0] === ';' || line[0] === '#') {
      continue;
    }

    // Check for section header
    if (line[0] === '[') {
      const closeIdx = line.indexOf(']');
      if (closeIdx === -1) {
        const err = new SyntaxError();
        err.line = lineNumber;
        throw err;
      }

      const sectionName = line.slice(1, closeIdx).trim();
      if (sectionName === '') {
        const err = new SyntaxError();
        err.line = lineNumber;
        throw err;
      }

      if (!result[sectionName]) {
        result[sectionName] = Object.create(null);
      }
      currentSection = result[sectionName];
      continue;
    }

    // Parse key = value
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      const err = new SyntaxError();
      err.line = lineNumber;
      throw err;
    }

    const key = line.slice(0, eqIdx).trim();
    if (key === '') {
      const err = new SyntaxError();
      err.line = lineNumber;
      throw err;
    }

    let value = line.slice(eqIdx + 1).trim();

    // Handle quoted values
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }

    currentSection[key] = value;
  }

  return result;
}

module.exports = { parseIni };
