'use strict';

function camelToSnake(name) {
  if (typeof name !== 'string') {
    throw new TypeError('Expected a string');
  }

  const isUpper = (c) => c >= 'A' && c <= 'Z';
  const isLower = (c) => c >= 'a' && c <= 'z';
  const isDigit = (c) => c >= '0' && c <= '9';

  let result = '';
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    const prev = name[i - 1];
    const next = name[i + 1];

    if (isUpper(char)) {
      const needsUnderscore = 
        (prev !== undefined && prev !== '_' && (isLower(prev) || isDigit(prev))) ||
        (prev !== undefined && prev !== '_' && isUpper(prev) && next !== undefined && isLower(next));

      if (needsUnderscore) {
        result += '_';
      }
      result += char.toLowerCase();
    } else {
      result += char;
    }
  }
  return result;
}

module.exports = { camelToSnake };
