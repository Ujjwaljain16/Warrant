'use strict';

const TABLE = [
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
  [1, 'I'],
];

// Canonical standard form only: at most three repeats of each digit place,
// with subtractive pairs for 4 and 9 in each place.
const CANONICAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError('toRoman expects an integer from 1 to 3999');
  }
  let rest = n;
  let out = '';
  for (const [value, symbol] of TABLE) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

function fromRoman(s) {
  if (typeof s !== 'string') {
    throw new TypeError('fromRoman expects a string');
  }
  if (s === '' || !CANONICAL.test(s)) {
    throw new SyntaxError(`Invalid Roman numeral: ${JSON.stringify(s)}`);
  }
  let total = 0;
  let i = 0;
  for (const [value, symbol] of TABLE) {
    while (s.startsWith(symbol, i)) {
      total += value;
      i += symbol.length;
    }
  }
  return total;
}

module.exports = { toRoman, fromRoman };
