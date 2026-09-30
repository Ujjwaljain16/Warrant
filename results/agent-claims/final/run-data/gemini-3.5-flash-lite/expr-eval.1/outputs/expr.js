'use strict';

function evaluate(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Input must be a string');
  }

  let i = 0;
  const tokens = [];

  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if ('+-*/%^()'.includes(c)) {
      tokens.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }

    if (/\d/.test(c) || c === '.') {
      const start = i;
      let hasDot = false;
      if (c === '.') {
        hasDot = true;
        i++;
      }
      if (!hasDot) {
        while (i < text.length && /\d/.test(text[i])) {
          i++;
        }
        if (i < text.length && text[i] === '.') {
          hasDot = true;
          i++;
        }
      }
      while (i < text.length && /\d/.test(text[i])) {
        i++;
      }
      const numStr = text.slice(start, i);
      if (numStr === '.' || numStr.endsWith('.')) {
        throw new SyntaxError(`Invalid number at position ${start}`);
      }
      tokens.push({ type: 'num', value: Number(numStr), pos: start });
      continue;
    }

    throw new SyntaxError(`Unknown character '${c}' at position ${i}`);
  }

  if (tokens.length === 0) {
    throw new SyntaxError('Empty expression');
  }

  let pos = 0;

  function peek() {
    return tokens[pos] || null;
  }

  function consume() {
    return tokens[pos++] || null;
  }

  function parseExpr() {
    const node = parseAdditive();
    if (peek() !== null) {
      throw new SyntaxError(`Unexpected token '${peek().value}' at position ${peek().pos}`);
    }
    return node;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (true) {
      const p = peek();
      if (p && p.type === 'op' && (p.value === '+' || p.value === '-')) {
        consume();
        const right = parseMultiplicative();
        left = { type: 'binary', op: p.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (true) {
      const p = peek();
      if (p && p.type === 'op' && (p.value === '*' || p.value === '/' || p.value === '%')) {
        consume();
        const right = parseUnary();
        left = { type: 'binary', op: p.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary() {
    const ops = [];
    while (true) {
      const p = peek();
      if (p && p.type === 'op' && (p.value === '+' || p.value === '-')) {
        ops.push(consume().value);
      } else {
        break;
      }
    }
    let node = parsePower();
    for (let j = ops.length - 1; j >= 0; j--) {
      node = { type: 'unary', op: ops[j], expr: node };
    }
    return node;
  }

  function parsePower() {
    const left = parsePrimary();
    const p = peek();
    if (p && p.type === 'op' && p.value === '^') {
      consume();
      const right = parseUnary();
      return { type: 'binary', op: '^', left, right };
    }
    return left;
  }

  function parsePrimary() {
    const p = peek();
    if (!p) {
      throw new SyntaxError('Unexpected end of expression');
    }

    if (p.type === 'num') {
      consume();
      return { type: 'value', value: p.value };
    }

    if (p.type === 'op' && p.value === '(') {
      consume();
      const node = parseAdditive();
      const next = consume();
      if (!next || next.type !== 'op' || next.value !== ')') {
        throw new SyntaxError('Unbalanced parentheses');
      }
      return node;
    }

    throw new SyntaxError(`Unexpected token '${p.value}' at position ${p.pos}`);
  }

  const ast = parseExpr();

  function evaluateAst(node) {
    if (node.type === 'value') {
      return node.value;
    }
    if (node.type === 'unary') {
      const val = evaluateAst(node.expr);
      if (node.op === '-') return -val;
      if (node.op === '+') return +val;
    }
    if (node.type === 'binary') {
      const leftVal = evaluateAst(node.left);
      const rightVal = evaluateAst(node.right);
      switch (node.op) {
        case '+': return leftVal + rightVal;
        case '-': return leftVal - rightVal;
        case '*': return leftVal * rightVal;
        case '/':
          if (rightVal === 0) {
            throw new RangeError('Division by zero');
          }
          return leftVal / rightVal;
        case '%':
          if (rightVal === 0) {
            throw new RangeError('Remainder by zero');
          }
          return leftVal % rightVal;
        case '^':
          return Math.pow(leftVal, rightVal);
      }
    }
    throw new Error('Unknown AST node');
  }

  return evaluateAst(ast);
}

module.exports = { evaluate };
