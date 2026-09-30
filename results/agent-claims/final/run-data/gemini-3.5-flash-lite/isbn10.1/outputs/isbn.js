'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Expected a string');
  }

  // Remove hyphens and spaces
  let cleaned = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '-' || char === ' ') {
      continue;
    }
    cleaned += char;
  }

  // Must be exactly 10 characters
  if (cleaned.length !== 10) {
    return false;
  }

  // First 9 characters must be digits 0-9
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const char = cleaned[i];
    if (char < '0' || char > '9') {
      return false;
    }
    const digit = parseInt(char, 10);
    sum += digit * (10 - i);
  }

  // 10th character (check character)
  const lastChar = cleaned[9];
  let lastVal = 0;
  if (lastChar >= '0' && lastChar <= '9') {
    lastVal = parseInt(lastChar, 10);
  } else if (lastChar === 'X' || lastChar === 'x') {
    lastVal = 10;
  } else {
    return false;
  }

  sum += lastVal * 1; // weight 1 for the last character

  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
