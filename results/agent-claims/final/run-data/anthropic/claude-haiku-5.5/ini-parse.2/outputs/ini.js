'use strict';

function parseIni(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const result = Object.create(null);
  let currentSection = result;
  const lines = text.split(/\r?\n/);

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let line = lines[lineNum].trim();

    // Skip blank lines and comments
    if (!line || line[0] === ';' || line[0] === '#') {
      continue;
    }

    // Check for section header
    if (line[0] === '[') {
      const closeIndex = line.indexOf(']');
      if (closeIndex === -1) {
        const err = new SyntaxError();
        err.line = lineNum + 1;
        throw err;
      }
      const sectionName = line.slice(1, closeIndex).trim();
      if (!sectionName) {
        const err = new SyntaxError();
        err.line = lineNum + 1;
        throw err;
      }
      if (!result[sectionName]) {
        result[sectionName] = Object.create(null);
      }
      currentSection = result[sectionName];
      continue;
    }

    // Parse key=value
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      const err = new SyntaxError();
      err.line = lineNum + 1;
      throw err;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key) {
      const err = new SyntaxError();
      err.line = lineNum + 1;
      throw err;
    }

    let value = line.slice(eqIndex + 1).trim();

    // Handle quoted values
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }

    currentSection[key] = value;
  }

  return result;
}

module.exports = { parseIni };
