'use strict';

function parseQuery(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Argument must be a string');
  }

  if (str.startsWith('?')) {
    str = str.slice(1);
  }

  const result = Object.create(null);
  if (!str) return result;

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

    key = decodeComponent(key);
    value = decodeComponent(value);

    if (key in result) {
      if (Array.isArray(result[key])) {
        result[key].push(value);
      } else {
        result[key] = [result[key], value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

function decodeComponent(str) {
  let result = '';
  let i = 0;

  while (i < str.length) {
    const ch = str[i];

    if (ch === '+') {
      result += ' ';
      i++;
    } else if (ch === '%') {
      const bytes = [];
      let j = i;

      while (j < str.length && str[j] === '%') {
        if (j + 2 < str.length) {
          const hex = str.slice(j + 1, j + 3);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            bytes.push(parseInt(hex, 16));
            j += 3;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (bytes.length > 0) {
        result += decodeUTF8(bytes);
        i = j;
      } else {
        result += '%';
        i++;
      }
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

function decodeUTF8(bytes) {
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const b = bytes[i];

    if ((b & 0x80) === 0) {
      result += String.fromCharCode(b);
      i++;
    } else if ((b & 0xE0) === 0xC0) {
      if (i + 1 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80) {
        const codePoint = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
        if (codePoint >= 0x80) {
          result += String.fromCodePoint(codePoint);
          i += 2;
        } else {
          result += '\uFFFD';
          i++;
        }
      } else {
        result += '\uFFFD';
        i++;
      }
    } else if ((b & 0xF0) === 0xE0) {
      if (i + 2 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
        const codePoint = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
        if (codePoint >= 0x800 && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
          result += String.fromCodePoint(codePoint);
          i += 3;
        } else {
          result += '\uFFFD';
          i++;
        }
      } else {
        result += '\uFFFD';
        i++;
      }
    } else if ((b & 0xF8) === 0xF0) {
      if (i + 3 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80 && (bytes[i + 3] & 0xC0) === 0x80) {
        const codePoint = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        if (codePoint >= 0x10000 && codePoint <= 0x10FFFF) {
          result += String.fromCodePoint(codePoint);
          i += 4;
        } else {
          result += '\uFFFD';
          i++;
        }
      } else {
        result += '\uFFFD';
        i++;
      }
    } else {
      result += '\uFFFD';
      i++;
    }
  }

  return result;
}

module.exports = { parseQuery };
