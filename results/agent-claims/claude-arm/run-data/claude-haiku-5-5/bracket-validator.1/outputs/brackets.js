'use strict';

const PAIRS = { ')': '(', ']': '[', '}': '{' };
const OPENERS = new Set(['(', '[', '{']);

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('checkBrackets expects a string');
  }

  const stack = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '/') {
      // Line comment: skip to end of line (line break itself is not consumed as content).
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) break;
      i = nl;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        return { ok: false, reason: 'unterminated-comment', index: i };
      }
      i = end + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === '\n' || c === '\r') break;
        if (c === '\\') {
          // Escape: skip the next character as well (if it is a line break, the string is unterminated).
          if (i + 1 < n && text[i + 1] !== '\n' && text[i + 1] !== '\r') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) {
        return { ok: false, reason: 'unterminated-string', index: start };
      }
      continue;
    }

    if (OPENERS.has(ch)) {
      stack.push({ ch, index: i });
    } else if (ch in PAIRS) {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const top = stack[stack.length - 1];
      if (top.ch !== PAIRS[ch]) {
        return { ok: false, reason: 'mismatch', index: i };
      }
      stack.pop();
    }
    i++;
  }

  if (stack.length > 0) {
    return { ok: false, reason: 'unclosed', index: stack[stack.length - 1].index };
  }
  return { ok: true };
}

module.exports = { checkBrackets };
