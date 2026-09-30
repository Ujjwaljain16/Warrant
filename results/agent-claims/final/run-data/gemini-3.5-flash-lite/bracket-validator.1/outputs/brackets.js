'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }

  let i = 0;
  const len = text.length;
  const stack = [];

  while (i < len) {
    const ch = text[i];

    if (ch === '\'' || ch === '"') {
      const quote = ch;
      const startQuoteIndex = i;
      i++;
      let terminated = false;
      while (i < len) {
        const c = text[i];
        if (c === '\n' || c === '\r') {
          return { ok: false, reason: 'unterminated-string', index: startQuoteIndex };
        }
        if (c === '\\') {
          i++;
          if (i >= len) {
            return { ok: false, reason: 'unterminated-string', index: startQuoteIndex };
          }
          if (text[i] === '\n' || text[i] === '\r') {
            return { ok: false, reason: 'unterminated-string', index: startQuoteIndex };
          }
        } else if (c === quote) {
          terminated = true;
          i++;
          break;
        }
        i++;
      }
      if (!terminated) {
        return { ok: false, reason: 'unterminated-string', index: startQuoteIndex };
      }
      continue;
    }

    if (ch === '/' && i + 1 < len && text[i + 1] === '/') {
      i += 2;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }

    if (ch === '/' && i + 1 < len && text[i + 1] === '*') {
      const startCommentIndex = i;
      i += 2;
      let terminated = false;
      while (i < len) {
        if (text[i] === '*' && i + 1 < len && text[i + 1] === '/') {
          terminated = true;
          i += 2;
          break;
        }
        i++;
      }
      if (!terminated) {
        return { ok: false, reason: 'unterminated-comment', index: startCommentIndex };
      }
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ char: ch, index: i });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const matchingOpen = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const last = stack.pop();
      if (last.char !== matchingOpen) {
        return { ok: false, reason: 'mismatch', index: i };
      }
    }

    i++;
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return { ok: false, reason: 'unclosed', index: unclosed.index };
  }

  return { ok: true };
}

module.exports = { checkBrackets };
