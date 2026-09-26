'use strict';

function evaluate(_text) {
  if (typeof _text !== 'string') {
    throw new TypeError('Input must be a string');
  }
  const text = _text.trim();
  if (text === '') {
    throw new SyntaxError('Empty input');
  }

  let pos = 0;

  function skipWhitespace() {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  }

  function parseFactor() {
    skipWhitespace();
    if (text[pos] === '(') {
      pos++;
      const val = parseExpression();
      skipWhitespace();
      if (text[pos] !== ')') throw new SyntaxError('Unbalanced parentheses');
      pos++;
      return val;
    }
    if (text[pos] === '+' || text[pos] === '-') {
      const sign = text[pos++];
      skipWhitespace();
      if (text[pos] === '+' || text[pos] === '-') {
        const nextSign = text[pos++];
        skipWhitespace();
        if (text[pos] === '+' || text[pos] === '-' || /\d/.test(text[pos]) || text[pos] === '.') {
          return parseFactor();
        }
        throw new SyntaxError('Invalid unary operator sequence');
      }
      const val = parseFactor();
      return sign === '+' ? val : -val;
    }
    if (/\d/.test(text[pos]) || text[pos] === '.') {
      let n = '';
      while (pos < text.length && (/\d/.test(text[pos]) || text[pos] === '.')) {
        n += text[pos++];
      }
      const num = parseFloat(n);
      if (isNaN(num)) throw new SyntaxError('Invalid number');
      return num;
    }
    throw new SyntaxError('Unexpected character');
  }

  function parseTerm() {
    let val = parseFactor();
    while (pos < text.length) {
      skipWhitespace();
      const op = text[pos];
      if (op !== '*' && op !== '/' && op !== '%') break;
      pos++;
      skipWhitespace();
      const right = parseFactor();
      skipWhitespace();
      if (op === '*') val *= right;
      else if (op === '/') {
        if (right === 0) throw new RangeError('Division by zero');
        val /= right;
      } else {
        if (right === 0) throw new RangeError('Remainder by zero');
        val %= right;
      }
    }
    return val;
  }

  function parsePower() {
    let val = parseTerm();
    while (pos < text.length) {
      skipWhitespace();
      if (text[pos] !== '^') break;
      pos++;
      const right = parsePower();
      val = Math.pow(val, right);
    }
    return val;
  }

  function parseExpression() {
    let val = parsePower();
    while (pos < text.length) {
      skipWhitespace();
      const op = text[pos];
      if (op !== '+' && op !== '-') break;
      pos++;
      skipWhitespace();
      const right = parsePower();
      val += (op === '+' ? right : -right);
    }
    return val;
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < text.length) throw new SyntaxError('Extra characters after expression');
  return result;
}

module.exports = { evaluate };
