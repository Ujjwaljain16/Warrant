'use strict';

function isValidIsbn10(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const compact = text.replace(/[- ]/g, '');
  if (!/^\d{9}[\dXx]$/.test(compact)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = compact[i];
    const value = ch === 'X' || ch === 'x' ? 10 : Number(ch);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

module.exports = { isValidIsbn10 };
