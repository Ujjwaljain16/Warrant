'use strict';

function parseIni(_text) {
  if (typeof _text !== 'string') {
    throw new TypeError('parseIni: argument must be a string');
  }
  const lines = _text.split(/?
/);
  const result = Object.create(null);
  let current = result;
  let lineNum = 0;
  for (let line of lines) {
    lineNum++;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        const err = new SyntaxError('invalid section header');
        err.line = lineNum;
        throw err;
      }
      const name = trimmed.slice(1, -1).trim();
      if (name === '') {
        const err = new SyntaxError('empty section name');
        err.line = lineNum;
        throw err;
      }
      current = Object.create(null);
      if (result.hasOwnProperty(name)) {
        const existing = result[name];
        for (let k in existing) {
          current[k] = existing[k];
        }
      } else {
        result[name] = current;
      }
      continue;
    }
    const eqPos = trimmed.indexOf('=');
    if (eqPos === -1) {
      const err = new SyntaxError('invalid key line (no =)');
      err.line = lineNum;
      throw err;
    }
    const key = trimmed.slice(0, eqPos).trim();
    if (key === '') {
      const err = new SyntaxError('empty key');
      err.line = lineNum;
      throw err;
    }
    let val = trimmed.slice(eqPos + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      if (val.length < 3) {
        const err = new SyntaxError('invalid quoted value');
        err.line = lineNum;
        throw err;
      }
      val = val.slice(1, -1);
    }
    current[key] = val;
  }
  return result;
}

module.exports = { parseIni };
