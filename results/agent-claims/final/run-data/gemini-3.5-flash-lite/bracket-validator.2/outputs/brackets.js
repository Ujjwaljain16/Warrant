'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }

  let i = 0;
  const len = text.length;
  const stack = [];

  while (i < len) {
    const c = text[i];

    if (c === "'" || c === '"') {
      const quote = c;
      const startQuoteIndex = i;
      i++;
      let terminated = false;
      while (i < len) {
        const sc = text[i];
        if (sc === '\r' || sc === '\n') {
          return { ok: false, reason: 'unterminated-string', index: startQuoteIndex };
        }
        if (sc === '\\') {
          i += 2;
          continue;
        }
        if (sc === quote) {
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

    if (c === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < len) {
        const sc = text[i];
        if (sc === '\n' || sc === '\r') {
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      const startCommentIndex = i;
      i += 2;
      let terminated = false;
      while (i < len - 1) {
        if (text[i] === '*' && text[i + 1] === '/') {
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

    if (c === '(' || c === '[' || c === '{') {
      stack.push({ char: c, index: i });
      i++;
      continue;
    }

    if (c === ')' || c === ']' || c === '}') {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const top = stack.pop();
      const expectedOpener = top.char === '(' ? ')' : top.char === '[' ? ']' : '}';
      if (expectedOpener !== c) {
        return { ok: false, reason: 'mismatch', index: i };
      }
      i++;
      continue;
    }

    i++;
  }

  if (stack.length > 0) {
    const innermost = stack[stack.length - 1];
    return { ok: false, reason: 'unclosed', index: innermost.index };
  }

  return { ok: true };
}

module.exports = { checkBrackets };
