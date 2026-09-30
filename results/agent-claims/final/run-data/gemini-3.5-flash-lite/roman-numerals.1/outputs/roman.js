'use strict';

const romanMap = [
  { val: 1000, numeral: 'M' },
  { val: 900, numeral: 'CM' },
  { val: 500, numeral: 'D' },
  { val: 400, numeral: 'CD' },
  { val: 100, numeral: 'C' },
  { val: 90, numeral: 'XC' },
  { val: 50, numeral: 'L' },
  { val: 40, numeral: 'XL' },
  { val: 10, numeral: 'X' },
  { val: 9, numeral: 'IX' },
  { val: 5, numeral: 'V' },
  { val: 4, numeral: 'IV' },
  { val: 1, numeral: 'I' }
];

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError('Input must be an integer between 1 and 3999');
  }

  let result = '';
  let num = n;
  for (const { val, numeral } of romanMap) {
    while (num >= val) {
      result += numeral;
      num -= val;
    }
  }
  return result;
}

const standardRegex = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function fromRoman(s) {
  if (typeof s !== 'string') {
    throw new TypeError('Input must be a string');
  }

  if (!standardRegex.test(s)) {
    throw new SyntaxError('Invalid Roman numeral');
  }

  const values = {
    M: 1000,
    D: 500,
    C: 100,
    L: 50,
    X: 10,
    V: 5,
    I: 1
  };

  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const current = values[s[i]];
    const next = values[s[i + 1]];
    if (next && current < next) {
      total += (next - current);
      i++;
    } else {
      total += current;
    }
  }

  return total;
}

module.exports = { toRoman, fromRoman };
