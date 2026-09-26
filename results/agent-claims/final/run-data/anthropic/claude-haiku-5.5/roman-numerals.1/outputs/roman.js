'use strict';

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError();
  }

  const romanMap = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];

  let result = '';
  for (const [value, numeral] of romanMap) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }

  return result;
}

function fromRoman(s) {
  if (typeof s !== 'string') {
    throw new TypeError();
  }

  const validPattern = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  if (!validPattern.test(s)) {
    throw new SyntaxError();
  }

  const romanValues = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000
  };

  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const current = romanValues[s[i]];
    const next = romanValues[s[i + 1]];

    if (next && current < next) {
      result += next - current;
      i++;
    } else {
      result += current;
    }
  }

  return result;
}

module.exports = { toRoman, fromRoman };
