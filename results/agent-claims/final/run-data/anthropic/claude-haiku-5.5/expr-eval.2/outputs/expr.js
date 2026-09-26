'use strict';

function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const tokens = tokenize(text);
  const parser = new Parser(tokens);
  return parser.parse();
}

function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    // Skip whitespace
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }

    // Numbers
    if (/\d/.test(text[i]) || (text[i] === '.' && /\d/.test(text[i + 1]))) {
      let num = '';
      while (i < text.length && /[\d.]/.test(text[i])) {
        num += text[i];
        i++;
      }
      if (num.endsWith('.')) {
        throw new SyntaxError();
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }

    // Operators and parentheses
    if ('+-*/%^()'.includes(text[i])) {
      tokens.push({ type: text[i], value: text[i] });
      i++;
      continue;
    }

    // Unknown character
    throw new SyntaxError();
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse() {
    if (this.tokens.length === 0) {
      throw new SyntaxError();
    }
    const result = this.parseAddSub();
    if (this.pos !== this.tokens.length) {
      throw new SyntaxError();
    }
    return result;
  }

  current() {
    return this.tokens[this.pos];
  }

  consume(expected) {
    if (!this.current() || this.current().type !== expected) {
      throw new SyntaxError();
    }
    this.pos++;
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.current() && (this.current().type === '+' || this.current().type === '-')) {
      const op = this.current().type;
      this.pos++;
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parsePower();
    while (this.current() && (this.current().type === '*' || this.current().type === '/' || this.current().type === '%')) {
      const op = this.current().type;
      this.pos++;
      const right = this.parsePower();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new RangeError();
        }
        left = left / right;
      } else {
        if (right === 0) {
          throw new RangeError();
        }
        left = left % right;
      }
    }
    return left;
  }

  parsePower() {
    let left = this.parseUnary();
    if (this.current() && this.current().type === '^') {
      this.pos++;
      const right = this.parsePower(); // right-associative
      left = Math.pow(left, right);
    }
    return left;
  }

  parseUnary() {
    let sign = 1;
    while (this.current() && (this.current().type === '+' || this.current().type === '-')) {
      if (this.current().type === '-') {
        sign *= -1;
      }
      this.pos++;
    }
    return sign * this.parseFactor();
  }

  parseFactor() {
    if (!this.current()) {
      throw new SyntaxError();
    }
    if (this.current().type === 'NUMBER') {
      const value = this.current().value;
      this.pos++;
      return value;
    }
    if (this.current().type === '(') {
      this.pos++;
      const result = this.parseAddSub();
      if (!this.current() || this.current().type !== ')') {
        throw new SyntaxError();
      }
      this.pos++;
      return result;
    }
    throw new SyntaxError();
  }
}

module.exports = { evaluate };
