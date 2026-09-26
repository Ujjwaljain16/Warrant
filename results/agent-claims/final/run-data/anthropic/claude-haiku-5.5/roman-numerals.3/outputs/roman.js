'use strict';

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError('Value must be an integer between 1 and 3999');
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
    throw new TypeError('Input must be a string');
  }

  const romanMap = {
    'I': 1,
    'V': 5,
    'X': 10,
    'L': 50,
    'C': 100,
    'D': 500,
    'M': 1000
  };

  if (!/^[IVXLCDM]+$/.test(s)) {
    throw new SyntaxError('Invalid Roman numeral format');
  }

  if (/IIII|XXXX|CCCC|MMMM/.test(s)) {
    throw new SyntaxError('Invalid Roman numeral format');
  }

  if (/IL|IC|ID|IM|XD|XM|VX|VL|VC|VD|VM|LC|LD|LM|DM/.test(s)) {
    throw new SyntaxError('Invalid Roman numeral format');
  }

  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const current = romanMap[s[i]];
    const next = romanMap[s[i + 1]];
    
    if (next && current < next) {
      result += next - current;
      i++;
    } else {
      result += current;
    }
  }

  if (result < 1 || result > 3999) {
    throw new SyntaxError('Invalid Roman numeral format');
  }

  if (toRoman(result) !== s) {
    throw new SyntaxError('Invalid Roman numeral format');
  }

  return result;
}

module.exports = { toRoman, fromRoman };
