'use strict';

const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const CANONICAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError('n must be an integer from 1 to 3999');
  let left = n;
  let out = '';
  for (const [value, symbol] of TABLE) {
    while (left >= value) { out += symbol; left -= value; }
  }
  return out;
}

function fromRoman(s) {
  if (typeof s !== 'string') throw new TypeError('s must be a string');
  if (s === '' || !CANONICAL.test(s)) throw new SyntaxError(`not a canonical Roman numeral: ${s}`);
  let total = 0;
  let rest = s;
  for (const [value, symbol] of TABLE) {
    while (rest.startsWith(symbol)) { total += value; rest = rest.slice(symbol.length); }
  }
  return total;
}

module.exports = { toRoman, fromRoman };
