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
    const isUpper = char >= 'A' && char <= 'Z';
    const isLower = char >= 'a' && char <= 'z';
    const isDigit = char >= '0' && char <= '9';
    const isUnderscore = char === '_';

    if (isUpper) {
      // Check if we need to insert underscore before this uppercase letter
      if (i > 0) {
        const prevChar = name[i - 1];
        const prevIsLower = prevChar >= 'a' && prevChar <= 'z';
        const prevIsDigit = prevChar >= '0' && prevChar <= '9';
        const prevIsUnderscore = prevChar === '_';
        const prevIsUpper = prevChar >= 'A' && prevChar <= 'Z';

        // Insert underscore if previous char is lowercase, digit, or if this starts a new word after acronym
        if (!prevIsUnderscore) {
          if (prevIsLower || prevIsDigit) {
            result += '_';
          } else if (prevIsUpper) {
            // Check if next char is lowercase (this upper starts a new word after acronym)
            const nextChar = i + 1 < name.length ? name[i + 1] : '';
            const nextIsLower = nextChar >= 'a' && nextChar <= 'z';
            if (nextIsLower) {
              result += '_';
            }
          }
        }
      }
      result += char.toLowerCase();
    } else {
      result += char;
    }
  }

  return result;
}

module.exports = { camelToSnake };
