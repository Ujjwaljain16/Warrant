'use strict';

function camelToSnake(name) {
  if (typeof name !== 'string') {
    throw new TypeError();
  }

  if (name.length === 0) {
    return '';
  }

  let result = '';

  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    const prevChar = i > 0 ? name[i - 1] : '';
    const nextChar = i < name.length - 1 ? name[i + 1] : '';

    const isUpper = char >= 'A' && char <= 'Z';
    const isLower = char >= 'a' && char <= 'z';
    const isDigit = char >= '0' && char <= '9';
    const prevIsLower = prevChar >= 'a' && prevChar <= 'z';
    const prevIsDigit = prevChar >= '0' && prevChar <= '9';
    const prevIsUpper = prevChar >= 'A' && prevChar <= 'Z';
    const nextIsLower = nextChar >= 'a' && nextChar <= 'z';
    const nextIsUpper = nextChar >= 'A' && nextChar <= 'Z';

    if (char === '_') {
      result += '_';
    } else if (isUpper) {
      if ((prevIsLower || prevIsDigit) || (prevIsUpper && nextIsLower)) {
        if (result.length > 0 && result[result.length - 1] !== '_') {
          result += '_';
        }
      }
      result += char.toLowerCase();
    } else if (isLower || isDigit) {
      result += char;
    }
  }

  return result;
}

module.exports = { camelToSnake };
