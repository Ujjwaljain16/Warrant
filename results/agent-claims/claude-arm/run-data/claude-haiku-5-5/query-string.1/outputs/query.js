'use strict';

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function isHex(ch) {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'f') ||
    (ch >= 'A' && ch <= 'F')
  );
}

// Decode one query component: '+' becomes a space, %XX escapes are bytes,
// everything else is literal text. The resulting bytes are decoded as UTF-8
// together so that multi-byte sequences spanning escapes work, and invalid
// bytes become U+FFFD.
function decodeComponent(s) {
  if (s.indexOf('+') === -1 && s.indexOf('%') === -1) return s;

  const bytes = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '+') {
      bytes.push(0x20);
      i += 1;
    } else if (ch === '%' && i + 2 < s.length &&isHex(s[i + 1]) && isHex(s[i + 2])) {
      bytes.push(parseInt(s.substr(i + 1, 2), 16));
      i += 3;
    } else {
      // Literal character (may be a surrogate pair): push its UTF-8 bytes.
      const cp = s.codePointAt(i);
      const literal = String.fromCodePoint(cp);
      for (const b of utf8Encoder.encode(literal)) bytes.push(b);
      i += literal.length;
    }
  }
  return utf8Decoder.decode(Uint8Array.from(bytes));
}

function parseQuery(str) {
  if (typeof str !== 'string') {
    throw new TypeError('parseQuery expects a string');
  }

  const body = str.startsWith('?') ? str.slice(1) : str;
  const result = Object.create(null);

  for (const segment of body.split('&')) {
    if (segment === '') continue;

    const eq = segment.indexOf('=');
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawValue = eq === -1 ? '' : segment.slice(eq + 1);
    if (rawKey === '') continue;

    const key = decodeComponent(rawKey);
    const value = decodeComponent(rawValue);

    if (!(key in result)) {
      result[key] = value;
    } else if (Array.isArray(result[key])) {
      result[key].push(value);
    } else {
      result[key] = [result[key], value];
    }
  }

  return result;
}

module.exports = { parseQuery };
