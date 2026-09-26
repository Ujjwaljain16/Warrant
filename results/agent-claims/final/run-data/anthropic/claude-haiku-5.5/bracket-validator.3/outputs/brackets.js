'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Input must be a string');
  }

  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    // Handle strings
    if (char === '"' || char === "'") {
      const quote = char;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
        } else if (text[i] === quote) {
          i++;
          break;
        } else if (text[i] === '\n') {
          return { ok: false, reason: 'unterminated-string', index: i - 1 };
        } else {
          i++;
        }
      }
      if (i > text.length || text[i - 1] !== quote) {
        return { ok: false, reason: 'unterminated-string', index: i - 1 };
      }
      continue;
    }

    // Handle line comments
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Handle block comments
    if (char === '/' && text[i + 1] === '*') {
      const commentStart = i;
      i += 2;
      while (i < text.length - 1) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      if (i >= text.length - 1 && !(text[i - 2] === '*' && text[i - 1] === '/')) {
        return { ok: false, reason: 'unterminated-comment', index: commentStart };
      }
      continue;
    }

    // Handle brackets
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ char, index: i });
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const last = stack[stack.length - 1];
      if (pairs[char] !== last.char) {
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
