'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') {
    throw new TypeError('ISBN must be a string');
  }

  const cleaned = text.replace(/[-\s]/g, '');

  if (cleaned.length !== 10) {
    return false;
  }

  const pattern = /^\d{9}[0-9X]$/i;
  if (!pattern.test(cleaned)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i], 10) * (10 - i);
  }

  const checkChar = cleaned[9].toUpperCase();
  const checkValue = checkChar === 'X' ? 10 : parseInt(checkChar, 10);
  sum += checkValue * 1;

  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
