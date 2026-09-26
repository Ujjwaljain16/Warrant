'use strict';

function parseQuery(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Argument must be a string');
  }

  // Remove leading ?
  if (str.startsWith('?')) {
    str = str.slice(1);
  }

  const result = Object.create(null);
  const seen = Object.create(null);

  if (!str) {
    return result;
  }

  const segments = str.split('&');

  for (const segment of segments) {
    if (!segment) continue;

    const eqIndex = segment.indexOf('=');
    let key, value;

    if (eqIndex === -1) {
      key = segment;
      value = '';
    } else {
      key = segment.slice(0, eqIndex);
      value = segment.slice(eqIndex + 1);
    }

    if (!key) continue;

    key = decode(key);
    value = decode(value);

    if (seen[key]) {
      if (Array.isArray(result[key])) {
        result[key].push(value);
      } else {
        result[key] = [result[key], value];
      }
    } else {
      result[key] = value;
      seen[key] = true;
    }
  }

  return result;
}

function decode(str) {
  let result = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '+') {
      result += ' ';
      i++;
    } else if (ch === '%' && i + 2 < str.length) {
      const hex = str.slice(i + 1, i + 3);
      if (isValidHex(hex)) {
        const bytes = [parseInt(hex, 16)];
        let j = i + 3;

        while (j + 2 < str.length && str[j] === '%') {
          const nextHex = str.slice(j + 1, j + 3);
          if (isValidHex(nextHex)) {
            bytes.push(parseInt(nextHex, 16));
            j += 3;
          } else {
            break;
          }
        }

        result += decodeUtf8Bytes(bytes);
        i = j;
      } else {
        result += ch;
        i++;
      }
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

function isValidHex(str) {
  if (str.length !== 2) return false;
  const code1 = str.charCodeAt(0);
  const code2 = str.charCodeAt(1);
  return isHexDigit(code1) && isHexDigit(code2);
}

function isHexDigit(code) {
  return (code >= 48 && code <= 57) ||
         (code >= 65 && code <= 70) ||
         (code >= 97 && code <= 102);
}

function decodeUtf8Bytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(bytes)
    );
  } catch {
    return String.fromCharCode(...bytes.map(() => 0xFFFD));
  }
}

module.exports = { parseQuery };
