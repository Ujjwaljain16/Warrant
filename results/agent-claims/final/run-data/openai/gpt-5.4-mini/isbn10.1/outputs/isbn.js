'use strict';

function isValidIsbn10(_text) {
  if (typeof _text !== 'string') {
    throw new TypeError('isValidIsbn10: argument must be a string');
  }

  const text = _text.replace(/[-\s]/g, ''); // remove hyphens and spaces

  if (text.length !== 10) {
    return false;
  }

  // Validate characters: exactly 9 digits + check digit (0-9 or X/x)
  for (let i = 0; i < 9; i++) {
    const char = text[i];
    if (char < '0' || char > '9') {
      return false;
    }
  }

  const checkChar = text[9];
  const checkVal = (checkChar === 'X' || checkChar === 'x') ? 10 : parseInt(checkChar, 10);
  if (isNaN(checkVal) || checkVal < 0 || checkVal > 10) {
    return false;
  }

  // Weighted sum: weights 10, 9, 8, ..., 1
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (10 - i) * parseInt(text[i], 10);
  }

  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
