'use strict';

function camelToSnake(name) {
  if (typeof name !== 'string') {
    throw new TypeError('Expected a string');
  }

  let result = '';
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    const isUpper = char >= 'A' && char <= 'Z';
    
    if (isUpper && i > 0) {
      const prev = name[i - 1];
      const prevIsLowerOrDigit = (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9');
      const next = i + 1 < name.length ? name[i + 1] : '';
      const nextIsLower = next >= 'a' && next <= 'z';

      const isLastCapitalBeforeLower = (prev >= 'A' && prev <= 'Z') && nextIsLower;

      if (prevIsLowerOrDigit || isLastCapitalBeforeLower) {
        if (prev !== '_') {
          result += '_';
        }
      }
    }

    result += char.toLowerCase();
  }

  return result;
}

module.exports = { camelToSnake };
