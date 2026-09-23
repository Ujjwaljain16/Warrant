'use strict';

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(text.slice(i));
    if (m) { tokens.push({ type: 'num', value: Number(m[0]) }); i += m[0].length; continue; }
    if ('+-*/%^()'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new SyntaxError(`unexpected character ${JSON.stringify(c)}`);
  }
  return tokens;
}

function evaluate(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t, v) => t && t.type === 'op' && t.value === v;

  function expression() {
    let left = term();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = tokens[pos++].value;
      const right = term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function term() {
    let left = unary();
    while (isOp(peek(), '*') || isOp(peek(), '/') || isOp(peek(), '%')) {
      const op = tokens[pos++].value;
      const right = unary();
      if (op === '*') left *= right;
      else {
        if (right === 0) throw new RangeError('division by zero');
        left = op === '/' ? left / right : left % right;
      }
    }
    return left;
  }

  function unary() {
    if (isOp(peek(), '-')) { pos++; return -unary(); }
    if (isOp(peek(), '+')) { pos++; return unary(); }
    return power();
  }

  function power() {
    const base = primary();
    if (isOp(peek(), '^')) { pos++; return base ** unary(); }
    return base;
  }

  function primary() {
    const t = tokens[pos];
    if (!t) throw new SyntaxError('unexpected end of expression');
    if (t.type === 'num') { pos++; return t.value; }
    if (isOp(t, '(')) {
      pos++;
      const value = expression();
      if (!isOp(peek(), ')')) throw new SyntaxError('missing closing parenthesis');
      pos++;
      return value;
    }
    throw new SyntaxError(`unexpected token ${t.value}`);
  }

  const result = expression();
  if (pos !== tokens.length) throw new SyntaxError('unexpected trailing input');
  return result;
}

module.exports = { evaluate };
