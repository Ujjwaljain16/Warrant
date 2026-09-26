'use strict';

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError();
  }

  const values = [
    { num: 1000, str: 'M' },
    { num: 900, str: 'CM' },
    { num: 500, str: 'D' },
    { num: 400, str: 'CD' },
    { num: 100, str: 'C' },
    { num: 90, str: 'XC' },
    { num: 50, str: 'L' },
    { num: 40, str: 'XL' },
    { num: 10, str: 'X' },
    { num: 9, str: 'IX' },
    { num: 5, str: 'V' },
    { num: 4, str: 'IV' },
    { num: 1, str: 'I' }
  ];

  let result = '';
  for (const { num, str } of values) {
    while (n >= num) {
      result += str;
      n -= num;
    }
  }
  return result;
}

function fromRoman(s) {
  if (typeof s !== 'string') {
    throw new TypeError();
  }

  const romanValues = {
    'I': 1,
    'V': 5,
    'X': 10,
    'L': 50,
    'C': 100,
    'D': 500,
    'M': 1000
  };

  const validPairs = new Set(['IV', 'IX', 'XL', 'XC', 'CD', 'CM']);

  let result = 0;
  let i = 0;

  while (i < s.length) {
    const char = s[i];

    if (!(char in romanValues)) {
      throw new SyntaxError();
    }

    if (i + 1 < s.length) {
      const pair = s.substring(i, i + 2);
      if (validPairs.has(pair)) {
        result += romanValues[pair[1]] - romanValues[pair[0]];
        i += 2;
        continue;
      }
    }

    result += romanValues[char];
    i += 1;
  }

  if (result < 1 || result > 3999) {
    throw new SyntaxError();
  }

  if (toRoman(result) !== s) {
    throw new SyntaxError();
  }

  return result;
}

module.exports = { toRoman, fromRoman };
