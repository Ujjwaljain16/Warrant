'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Input must be a string');
  }

  const stack = [];
  const pairs = {
    ')': '(',
    ']': '[',
    '}': '{'
  };
  const openBrackets = { '(': true, '[': true, '{': true };
  const closeBrackets = { ')': true, ']': true, '}': true };

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    // Block comment
    if (char === '/' && text[i + 1] === '*') {
      const start = i;
      i += 2;
      let found = false;
      while (i < text.length) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          found = true;
          break;
        }
        i++;
      }
      if (!found) {
        return { ok: false, reason: 'unterminated-comment', index: start };
      }
      continue;
    }

    // Line comment
    if (char === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }

    // String literals
    if (char === "'" || char === '"') {
      const quote = char;
      const start = i;
      i++;
      let found = false;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          found = true;
          break;
        }
        if (text[i] === '\n' || text[i] === '\r') {
          break;
        }
        i++;
      }
      if (!found) {
        return { ok: false, reason: 'unterminated-string', index: start };
      }
      continue;
    }

    // Brackets
    if (openBrackets[char]) {
      stack.push({ char, index: i });
    } else if (closeBrackets[char]) {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const last = stack.pop();
      if (last.char !== pairs[char]) {
        return { ok: false, reason: 'mismatch', index: i };
      }
    }

    i++;
  }

  if (stack.length > 0) {
    const last = stack.pop();
    return { ok: false, reason: 'unclosed', index: last.index };
  }

  return { ok: true };
}

module.exports = { checkBrackets };