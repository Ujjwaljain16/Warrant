'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Input must be a string');
  }

  const cleaned = text.replace(/[-\s]/g, '');

  if (cleaned.length !== 10) {
    return false;
  }

  for (let i = 0; i < 9; i++) {
    const char = cleaned[i];
    if (char < '0' || char > '9') {
      return false;
    }
  }

  const checkChar = cleaned[9];
  if (!((checkChar >= '0' && checkChar <= '9') || checkChar === 'X' || checkChar === 'x')) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (cleaned[i] - '0') * (10 - i);
  }

  const checkValue = checkChar === 'X' || checkChar === 'x' ? 10 : (checkChar - '0');
  sum += checkValue * 1;

  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
