'use strict';

function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    throw new SyntaxError();
  }
  const parser = new Parser(tokens);
  return parser.parse();
}

function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/\d/.test(char) || (char === '.' && i + 1 < text.length && /\d/.test(text[i + 1]))) {
      let num = '';
      let hasDot = false;
      while (i < text.length && (/\d/.test(text[i]) || (text[i] === '.' && !hasDot))) {
        if (text[i] === '.') hasDot = true;
        num += text[i];
        i++;
      }
      if (num.endsWith('.')) {
        throw new SyntaxError();
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
    } else if ('+-*/%^()'.includes(char)) {
      tokens.push({ type: char, value: char });
      i++;
    } else {
      throw new SyntaxError();
    }
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse() {
    const result = this.parseAddSub();
    if (this.pos !== this.tokens.length) {
      throw new SyntaxError();
    }
    return result;
  }

  peek() {
    return this.tokens[this.pos];
  }

  consume() {
    return this.tokens[this.pos++];
  }

  parseAddSub() {
    let left = this.parseMulDiv();

    while (this.peek() && (this.peek().type === '+' || this.peek().type === '-')) {
      const op = this.consume().type;
      const right = this.parseMulDiv();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  parseMulDiv() {
    let left = this.parsePower();

    while (this.peek() && (this.peek().type === '*' || this.peek().type === '/' || this.peek().type === '%')) {
      const op = this.consume().type;
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
    let base = this.parseUnary();

    if (this.peek() && this.peek().type === '^') {
      this.consume();
      const exponent = this.parsePower();
      return Math.pow(base, exponent);
    }

    return base;
  }

  parseUnary() {
    const signs = [];
    while (this.peek() && (this.peek().type === '+' || this.peek().type === '-')) {
      const op = this.consume().type;
      signs.push(op);
    }

    let value = this.parseFactor();
    for (let i = signs.length - 1; i >= 0; i--) {
      if (signs[i] === '-') {
        value = -value;
      }
    }
    return value;
  }

  parseFactor() {
    const token = this.peek();

    if (!token) {
      throw new SyntaxError();
    }

    if (token.type === 'number') {
      this.consume();
      return token.value;
    }

    if (token.type === '(') {
      this.consume();
      const result = this.parseAddSub();
      if (!this.peek() || this.peek().type !== ')') {
        throw new SyntaxError();
      }
      this.consume();
      return result;
    }

    throw new SyntaxError();
  }
}

module.exports = { evaluate };
