'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') {
    throw new TypeError('isValidIsbn10 expects a string');
  }

  const cleaned = text.replace(/[- ]/g, '');
  if (!/^[0-9]{9}[0-9Xx]$/.test(cleaned)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = cleaned[i];
    const value = ch === 'X' || ch === 'x' ? 10 : ch.charCodeAt(0) - 48;
    sum += value * (10 - i);
  }

  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
