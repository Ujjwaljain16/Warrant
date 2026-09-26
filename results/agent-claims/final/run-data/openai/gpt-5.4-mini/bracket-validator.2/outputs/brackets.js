'use strict';

function checkBrackets(_text) {
  if (typeof _text !== 'string') {
    throw new TypeError('text must be a string');
  }
  const text = String(_text);

  const brackets = {
    '(': ')',
    '[': ']',
    '{': '}'
  };
  const reverse = {
    ')': '(',
    ']': '[',
    '}': '{'
  };

  const stack = [];
  let i = 0;

  function skipCommentOrString() {
    if (i >= text.length) return;
    const ch = text[i];
    if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        // line comment // to end of line
        i += 2;
        while (i < text.length && text[i] !== '
') i++;
      } else if (text[i + 1] === '*') {
        // block comment /* ... */
        i += 2;
        while (i + 1 < text.length) {
          if (text[i] === '*' && text[i + 1] === '/') {
            i += 2;
            return;
          }
          i++;
        }
        // unterminated comment
        return;
      }
    } else if (ch === '"' || ch === "'") {
      // string literal
      const quote = ch;
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === quote) {
          i++;
          return;
        } else if (c === '\' && i + 1 < text.length) {
          i += 2;
        } else {
          i++;
        }
      }
      // unterminated string
    }
  }

  while (i < text.length) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0) {
        return { ok: false, reason: 'unexpected-closer', index: i };
      }
      const expected = reverse[ch];
      if (stack[stack.length - 1] !== expected) {
        return { ok: false, reason: 'mismatch', index: i };
      }
      stack.pop();
    } else {
      skipCommentOrString();
      if (i >= text.length) break;
    }
    i++;
  }

  if (stack.length > 0) {
    return { ok: false, reason: 'unclosed', index: text.indexOf(stack[stack.length - 1]) };
  }

  return { ok: true };
}

module.exports = { checkBrackets };
