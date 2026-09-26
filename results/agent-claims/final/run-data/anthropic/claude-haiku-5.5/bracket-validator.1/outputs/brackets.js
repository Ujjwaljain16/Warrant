'use strict';

function checkBrackets(text) {
  if (typeof text !== 'string') {
    throw new TypeError();
  }

  const stack = [];
  const bracketPairs = { ')': '(', ']': '[', '}': '{' };
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
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        if (text[i] === '\n') {
          return { ok: false, reason: 'unterminated-string', index: i - 1 };
        }
        i++;
      }
      if (i > text.length || text[i - 1] !== quote) {
        const startIndex = i - 1;
        while (startIndex > 0 && (text[startIndex - 1] === '"' || text[startIndex - 1] === "'")) {
          if ((text[startIndex - 1] === '"' && quote === '"') || (text[startIndex - 1] === "'" && quote === "'")) {
            return { ok: false, reason: 'unterminated-string', index: startIndex - 1 };
          }
        }
        return { ok: false, reason: 'unterminated-string', index: i - 1 };
      }
      continue;
    }

    // Handle line comments
    if (char === '/' && i + 1 < text.length && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
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
      if (i >= text.length) {
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
      if (bracketPairs[char] !== last.char) {
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
