'use strict';

function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Input must be a string');
  }

  let i = 0;
  const len = text.length;

  function skipWhitespace() {
    while (i < len && /\s/.test(text[i])) {
      i++;
    }
  }

  const tokens = [];

  while (true) {
    skipWhitespace();
    if (i >= len) break;

    const c = text[i];

    if ((c >= '0' && c <= '9') || c === '.') {
      let start = i;
      let dotCount = (c === '.') ? 1 : 0;
      let digitCountBeforeDot = (c >= '0' && c <= '9') ? 1 : 0;
      let digitCountAfterDot = 0;
      i++;

      while (i < len) {
        const nc = text[i];
        if (nc >= '0' && nc <= '9') {
          if (dotCount > 0) digitCountAfterDot++;
          else digitCountBeforeDot++;
          i++;
        } else if (nc === '.' && dotCount === 0) {
          dotCount = 1;
          i++;
        } else {
          break;
        }
      }

      if (dotCount === 1 && digitCountAfterDot === 0) {
        throw new SyntaxError('Invalid number format: trailing dot');
      }
      if (dotCount === 1 && digitCountBeforeDot === 0 && digitCountAfterDot === 0) {
        throw new SyntaxError('Invalid number format: single dot');
      }

      const numStr = text.slice(start, i);
      const val = Number(numStr);
      tokens.push({ type: 'NUMBER', value: val });
      continue;
    }

    if ('+-*/%^()'.includes(c)) {
      tokens.push({ type: 'OP', value: c });
      i++;
      continue;
    }

    throw new SyntaxError('Unknown character: ' + c);
  }

  if (tokens.length === 0) {
    throw new SyntaxError('Empty expression');
  }

  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume() {
    return tokens[pos++];
  }

  function parseExpression() {
    const val = parseAdditive();
    if (pos < tokens.length) {
      throw new SyntaxError('Unexpected token at end of expression');
    }
    return val;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (true) {
      const t = peek();
      if (t && t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        consume();
        const right = parseMultiplicative();
        if (t.value === '+') {
          left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t && t.type === 'OP' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        consume();
        const right = parseUnary();
        if (t.value === '*') {
          left = left * right;
        } else if (t.value === '/') {
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          left = left / right;
        } else {
          if (right === 0) {
            throw new RangeError('Remainder by zero');
          }
          left = left % right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary() {
    let sign = 1;
    let hasUnary = false;
    while (true) {
      const t = peek();
      if (t && t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        consume();
        hasUnary = true;
        if (t.value === '-') {
          sign = -sign;
        }
      } else {
        break;
      }
    }

    const val = parsePower();
    return hasUnary ? sign * val : val;
  }

  function parsePower() {
    const base = parsePrimary();
    const t = peek();
    if (t && t.type === 'OP' && t.value === '^') {
      consume();
      const exponent = parsePowerOrUnaryForExponent();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePowerOrUnaryForExponent() {
    let sign = 1;
    let hasUnary = false;
    while (true) {
      const t = peek();
      if (t && t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        consume();
        hasUnary = true;
        if (t.value === '-') {
          sign = -sign;
        }
      } else {
        break;
      }
    }
    const base = parsePrimary();
    const t = peek();
    let val;
    if (t && t.type === 'OP' && t.value === '^') {
      consume();
      const exponent = parsePowerOrUnaryForExponent();
      val = Math.pow(base, exponent);
    } else {
      val = base;
    }
    return hasUnary ? sign * val : val;
  }

  function parsePrimary() {
    const t = peek();
    if (!t) {
      throw new SyntaxError('Unexpected end of expression');
    }

    if (t.type === 'NUMBER') {
      consume();
      const next = peek();
      if (next && next.type === 'NUMBER') {
        throw new SyntaxError('Two numbers in a row');
      }
      if (next && next.type === 'OP' && next.value === '(') {
        throw new SyntaxError('Missing operator between number and parenthesis');
      }
      return t.value;
    }

    if (t.type === 'OP' && t.value === '(') {
      consume();
      const val = parseAdditive();
      const close = peek();
      if (!close || close.type !== 'OP' || close.value !== ')') {
        throw new SyntaxError('Unbalanced parentheses');
      }
      consume();
      
      const next = peek();
      if (next && next.type === 'NUMBER') {
        throw new SyntaxError('Missing operator between parenthesis and number');
      }
      if (next && next.type === 'OP' && next.value === '(') {
        throw new SyntaxError('Missing operator between parentheses');
      }

      return val;
    }

    if (t.type === 'OP' && t.value === ')') {
      throw new SyntaxError('Unbalanced parentheses');
    }

    if (t.type === 'OP') {
      throw new SyntaxError('Unexpected operator: ' + t.value);
    }

    throw new SyntaxError('Unexpected token');
  }

  return parseExpression();
}

module.exports = { evaluate };
