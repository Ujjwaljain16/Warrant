'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  // Remove hyphens and spaces
  const cleaned = text.replace(/[-\s]/g, '');

  // Must be exactly 10 characters
  if (cleaned.length !== 10) {
    return false;
  }

  // First 9 characters must be digits
  for (let i = 0; i < 9; i++) {
    if (!/\d/.test(cleaned[i])) {
      return false;
    }
  }

  // Last character must be digit or X (case-insensitive)
  const checkChar = cleaned[9].toUpperCase();
  if (!/[\dX]/.test(checkChar)) {
    return false;
  }

  // X is only allowed as the last character
  if (cleaned.substring(0, 9).includes('X') || cleaned.substring(0, 9).includes('x')) {
    return false;
  }

  // Calculate weighted sum
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (10 - i);
  }

  // Add weight for check character (X has value 10)
  const checkValue = checkChar === 'X' ? 10 : parseInt(checkChar);
  sum += checkValue * 1;

  // Valid if divisible by 11
  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
