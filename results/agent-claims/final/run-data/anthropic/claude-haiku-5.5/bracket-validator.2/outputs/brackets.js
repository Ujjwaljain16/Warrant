'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }

  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    // Handle strings
    if (char === '"' || char === "'") {
      const quote = char;
      const stringStart = i;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2; // Skip escaped character
        } else if (text[i] === quote) {
          i++;
          break;
        } else if (text[i] === '\n') {
          return { ok: false, reason: 'unterminated-string', index: stringStart };
        } else {
          i++;
        }
      }
      if (i === text.length && text[i - 1] !== quote) {
        return { ok: false, reason: 'unterminated-string', index: stringStart };
      }
      continue;
    }

    // Handle line comments
    if (char === '/' && i + 1 < text.length && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      if (i < text.length) i++; // Skip the newline
      continue;
    }

    // Handle block comments
    if (char === '/' && i + 1 < text.length && text[i + 1] === '*') {
      const commentStart = i;
      i += 2;
      while (i < text.length) {
        if (text[i] === '*' && i + 1 < text.length && text[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      if (i === text.length || text[i - 2] !== '*') {
        return { ok: false, reason: 'unterminated-comment', index: commentStart };
      }
      continue;
    }

    // Handle brackets
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ bracket: char, index: i });
      i++;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const last = stack[stack.length - 1];
      if (pairs[char] !== last.bracket) {
        return { ok: false, reason: 'mismatch', index: i };
      }
      stack.pop();
      i++;
      continue;
    }

    i++;
  }

  if (stack.length > 0) {
    return { ok: false, reason: 'unclosed', index: stack[stack.length - 1].index };
  }

  return { ok: true };
}

module.exports = { checkBrackets };
