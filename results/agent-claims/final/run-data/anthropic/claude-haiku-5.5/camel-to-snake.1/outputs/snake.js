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

    if (isUnderscore) {
      result += char;
      continue;
    }

    if (isUpper) {
      // Lookahead: find the run of consecutive uppercase letters
      let j = i + 1;
      while (j < name.length && name[j] >= 'A' && name[j] <= 'Z') {
        j++;
      }

      // j is now at the first non-uppercase char or end of string
      const runLength = j - i;
      const followedByLower = j < name.length && name[j] >= 'a' && name[j] <= 'z';

      // Insert underscore before uppercase if needed
      if (result.length > 0) {
        const prevChar = result[result.length - 1];
        const prevIsLower = prevChar >= 'a' && prevChar <= 'z';
        const prevIsDigit = prevChar >= '0' && prevChar <= '9';
        if ((prevIsLower || prevIsDigit) && prevChar !== '_') {
          result += '_';
        }
      }

      if (followedByLower && runLength > 1) {
        // Acronym followed by lowercase: add all but last uppercase as lowercase
        for (let k = i; k < j - 1; k++) {
          result += name[k].toLowerCase();
        }
        // Position at the last uppercase of the run; it will be processed next iteration
        i = j - 2;
      } else {
        // Single uppercase or run at end/followed by digit/underscore
        result += char.toLowerCase();
      }
    } else {
      result += char;
    }
  }

  return result;
}

module.exports = { camelToSnake };
