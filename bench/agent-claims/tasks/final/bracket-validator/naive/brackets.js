'use strict';

const PAIRS = { ')': '(', ']': '[', '}': '{' };

function checkBrackets(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') stack.push({ c, i });
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.length === 0) return { ok: false, reason: 'unexpected-closer', index: i };
      if (stack[stack.length - 1].c !== PAIRS[c]) return { ok: false, reason: 'mismatch', index: i };
      stack.pop();
    }
  }
  if (stack.length > 0) return { ok: false, reason: 'unclosed', index: stack[stack.length - 1].i };
  return { ok: true };
}

module.exports = { checkBrackets };
