'use strict';

function camelToSnake(_name) {
  if (typeof _name !== 'string') {
    throw new TypeError('camelToSnake expects a string');
  }
  if (_name === '') {
    return '';
  }

  let result = '';
  let i = 0;
  const n = _name.length;
  let prevWasUpper = false;
  let prevWasLower = false;
  let prevWasDigit = false;
  let prevWasUnderscore = false;

  while (i < n) {
    const char = _name[i];
    const isUpper = char >= 'A' && char <= 'Z';
    const isLower = char >= 'a' && char <= 'z';
    const isDigit = char >= '0' && char <= '9';
    const isUnderscore = char === '_';

    let shouldInsert = false;

    if (isUpper && !isUnderscore) {
      if (prevWasLower || prevWasDigit || prevWasUnderscore) {
        shouldInsert = true;
      } else if (i > 0) {
        const prevChar = _name[i - 1];
        const pUpper = prevChar >= 'A' && prevChar <= 'Z';
        const pLower = prevChar >= 'a' && prevChar <= 'z';
        const pDigit = prevChar >= '0' && prevChar <= '9';
        const pUnderscore = prevChar === '_';
        if (pLower || pDigit || pUnderscore) {
          shouldInsert = true;
        }
      }
      prevWasUpper = true;
      prevWasLower = false;
      prevWasDigit = false;
      prevWasUnderscore = false;
    } else if (isLower) {
      prevWasUpper = false;
      prevWasLower = true;
      prevWasDigit = false;
      prevWasUnderscore = false;
    } else if (isDigit) {
      prevWasUpper = false;
      prevWasLower = false;
      prevWasDigit = true;
      prevWasUnderscore = false;
    } else if (isUnderscore) {
      prevWasUpper = false;
      prevWasLower = false;
      prevWasDigit = false;
      prevWasUnderscore = true;
    }

    if (shouldInsert && result.length > 0) {
      result += '_';
    }
    if (!isUnderscore) {
      result += char.toLowerCase();
    }
    i++;
  }

  return result;
}

module.exports = { camelToSnake };