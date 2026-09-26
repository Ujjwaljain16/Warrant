'use strict';

function tokenize(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const tokens = [];
  let i = 0;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }

    if (/\d/.test(text[i]) || (text[i] === '.' && /\d/.test(text[i + 1]))) {
      let num = '';
      while (i < text.length && /\d/.test(text[i])) {
        num += text[i];
        i++;
      }
      if (i < text.length && text[i] === '.') {
        num += '.';
        i++;
        if (i >= text.length || !/\d/.test(text[i])) {
          throw new SyntaxError();
        }
        while (i < text.length && /\d/.test(text[i])) {
          num += text[i];
          i++;
        }
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
      continue;
    }

    if (['+', '-', '*', '/', '%', '^', '(', ')'].includes(text[i])) {
      tokens.push({ type: text[i] });
      i++;
      continue;
    }

    throw new SyntaxError();
  }

  return tokens;
}

function parse(tokens) {
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume() {
    return tokens[pos++];
  }

  function expression() {
    return additive();
  }

  function additive() {
    let left = multiplicative();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const right = multiplicative();
      left = { type: op, left, right };
    }
    return left;
  }

  function multiplicative() {
    let left = power();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = consume().type;
      const right = power();
      left = { type: op, left, right };
    }
    return left;
  }

  function power() {
    let left = unary();
    if (peek() && peek().type === '^') {
      consume();
      const right = power();
      return { type: '^', left, right };
    }
    return left;
  }

  function unary() {
    if (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const operand = unary();
      return { type: 'unary' + op, operand };
    }
    return factor();
  }

  function factor() {
    const token = peek();
    if (!token) {
      throw new SyntaxError();
    }
    if (token.type === 'number') {
      consume();
      return { type: 'number', value: token.value };
    }
    if (token.type === '(') {
      consume();
      const expr = expression();
      if (!peek() || peek().type !== ')') {
        throw new SyntaxError();
      }
      consume();
      return expr;
    }
    throw new SyntaxError();
  }

  const ast = expression();
  if (pos < tokens.length) {
    throw new SyntaxError();
  }
  return ast;
}

function evaluateAst(node) {
  if (node.type === 'number') {
    return node.value;
  }
  if (node.type === 'unary+') {
    return evaluateAst(node.operand);
  }
  if (node.type === 'unary-') {
    return -evaluateAst(node.operand);
  }
  if (node.type === '+') {
    return evaluateAst(node.left) + evaluateAst(node.right);
  }
  if (node.type === '-') {
    return evaluateAst(node.left) - evaluateAst(node.right);
  }
  if (node.type === '*') {
    return evaluateAst(node.left) * evaluateAst(node.right);
  }
  if (node.type === '/') {
    const right = evaluateAst(node.right);
    if (right === 0) {
      throw new RangeError();
    }
    return evaluateAst(node.left) / right;
  }
  if (node.type === '%') {
    const right = evaluateAst(node.right);
    if (right === 0) {
      throw new RangeError();
    }
    return evaluateAst(node.left) % right;
  }
  if (node.type === '^') {
    return Math.pow(evaluateAst(node.left), evaluateAst(node.right));
  }
}

function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new SyntaxError();
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    throw new SyntaxError();
  }
  const ast = parse(tokens);
  return evaluateAst(ast);
}

module.exports = { evaluate };
