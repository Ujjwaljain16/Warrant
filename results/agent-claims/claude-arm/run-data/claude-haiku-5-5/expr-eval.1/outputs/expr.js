'use strict';

// Tokenizer: produces an array of { type, value } tokens.
// Types: 'num', 'op' (+ - * / % ^), 'lparen', 'rparen', 'end'.
function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < n && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      const m = /^(\d+(?:\.\d+)?|\.\d+)/.exec(text.slice(i));
      tokens.push({ type: 'num', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
    } else if (ch === '(') {
      tokens.push({ type: 'lparen' });
    } else if (ch === ')') {
      tokens.push({ type: 'rparen' });
    } else {
      throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }
    i++;
  }
  tokens.push({ type: 'end' });
  return tokens;
}

// Recursive-descent parser and evaluator.
//
// expr   := term (('+' | '-') term)*
// term   := unary (('*' | '/' | '%') unary)*
// unary  := ('+' | '-') unary | power
// power  := primary ('^' unary)?        (right-associative, exponent may be signed)
// primary := number | '(' expr ')'
function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError('expression must be a string');
  }

  const tokens = tokenize(text);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expectEnd(tok) {
    if (tok.type === 'end') return;
    if (tok.type === 'rparen') throw new SyntaxError('Unbalanced parentheses');
    throw new SyntaxError('Unexpected token');
  }

  function parseExpr() {
    let value = parseTerm();
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value;
      const rhs = parseUnary();
      if (op === '*') {
        value = value * rhs;
      } else {
        if (rhs === 0) {
          throw new RangeError('Division by zero');
        }
        value = op === '/' ? value / rhs : value % rhs;
      }
    }
    return value;
  }

  function parseUnary() {
    const tok = peek();
    if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
      next();
      const operand = parseUnary();
      return tok.value === '-' ? -operand : operand;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    const tok = peek();
    if (tok.type === 'op' && tok.value === '^') {
      next();
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePrimary() {
    const tok = next();
    if (tok.type === 'num') {
      return tok.value;
    }
    if (tok.type === 'lparen') {
      const value = parseExpr();
      const close = next();
      if (close.type !== 'rparen') {
        throw new SyntaxError('Unbalanced parentheses');
      }
      return value;
    }
    if (tok.type === 'end') {
      throw new SyntaxError('Unexpected end of expression');
    }
    throw new SyntaxError('Unexpected token');
  }

  if (peek().type === 'end') {
    throw new SyntaxError('Empty expression');
  }
  const result = parseExpr();
  expectEnd(peek());
  return result;
}

module.exports = { evaluate };
