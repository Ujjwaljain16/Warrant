'use strict';

const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

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
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = VALUES[s[i]];
    const next = VALUES[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

module.exports = { toRoman, fromRoman };
