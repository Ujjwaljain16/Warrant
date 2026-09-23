'use strict';

const PAIRS = { ')': '(', ']': '[', '}': '{' };

function checkBrackets(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const start = i;
      i++;
      for (;;) {
        if (i >= text.length || text[i] === '\n' || text[i] === '\r') return { ok: false, reason: 'unterminated-string', index: start };
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return { ok: false, reason: 'unterminated-comment', index: i };
      i = end + 2;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') stack.push({ c, i });
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.length === 0) return { ok: false, reason: 'unexpected-closer', index: i };
      if (stack[stack.length - 1].c !== PAIRS[c]) return { ok: false, reason: 'mismatch', index: i };
      stack.pop();
    }
    i++;
  }
  if (stack.length > 0) return { ok: false, reason: 'unclosed', index: stack[stack.length - 1].i };
  return { ok: true };
}

module.exports = { checkBrackets };
