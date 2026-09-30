'use strict';

function decode(str) {
  let result = '';
  let i = 0;
  const len = str.length;

  function flushBytes(bytes) {
    if (bytes.length === 0) return '';
    return decodeUtf8Bytes(bytes);
  }

  let currentBytes = [];

  while (i < len) {
    const ch = str[i];
    if (ch === '+') {
      result += flushBytes(currentBytes);
      currentBytes = [];
      result += ' ';
      i++;
    } else if (ch === '%') {
      if (i + 2 < len) {
        const h1 = str[i + 1];
        const h2 = str[i + 2];
        if (isHex(h1) && isHex(h2)) {
          const byteVal = parseInt(h1 + h2, 16);
          currentBytes.push(byteVal);
          i += 3;
          continue;
        }
      }
      result += flushBytes(currentBytes);
      currentBytes = [];
      result += '%';
      i++;
    } else {
      result += flushBytes(currentBytes);
      currentBytes = [];
      result += ch;
      i++;
    }
  }
  result += flushBytes(currentBytes);
  return result;
}

function isHex(c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

function decodeUtf8Bytes(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i];
    if (b1 < 0x80) {
      out += String.fromCharCode(b1);
      i++;
    } else if ((b1 & 0xE0) === 0xC0) {
      if (i + 1 < bytes.length) {
        const b2 = bytes[i + 1];
        if ((b2 & 0xC0) === 0x80) {
          const code = ((b1 & 0x1F) << 6) | (b2 & 0x3F);
          if (code >= 0x80) {
            out += String.fromCharCode(code);
            i += 2;
            continue;
          }
        }
      }
      out += '�';
      i++;
    } else if ((b1 & 0xF0) === 0xE0) {
      if (i + 2 < bytes.length) {
        const b2 = bytes[i + 1];
        const b3 = bytes[i + 2];
        if ((b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
          const code = ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
          if (code >= 0x800 && !(code >= 0xD800 && code <= 0xDFFF)) {
            out += String.fromCharCode(code);
            i += 3;
            continue;
          }
        }
      }
      out += '�';
      i++;
    } else if ((b1 & 0xF8) === 0xF0) {
      if (i + 3 < bytes.length) {
        const b2 = bytes[i + 1];
        const b3 = bytes[i + 2];
        const b4 = bytes[i + 3];
        if ((b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80 && (b4 & 0xC0) === 0x80) {
          const code = ((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
          if (code >= 0x10000 && code <= 0x10FFFF) {
            const high = Math.floor((code - 0x10000) / 0x400) + 0xD800;
            const low = ((code - 0x10000) % 0x400) + 0xDC00;
            out += String.fromCharCode(high, low);
            i += 4;
            continue;
          }
        }
      }
      out += '�';
      i++;
    } else {
      out += '�';
      i++;
    }
  }
  return out;
}

function parseQuery(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Query string must be a string');
  }

  const result = Object.create(null);

  if (str.length === 0) {
    return result;
  }

  let start = 0;
  if (str.charCodeAt(0) === 63) {
    start = 1;
  }

  let i = start;
  while (i <= str.length) {
    let nextAmp = str.indexOf('&', i);
    if (nextAmp === -1) {
      nextAmp = str.length;
    }

    const segment = str.slice(i, nextAmp);
    if (segment.length > 0) {
      const eqIdx = segment.indexOf('=');
      let rawKey, rawVal;
      if (eqIdx === -1) {
        rawKey = segment;
        rawVal = '';
      } else {
        rawKey = segment.slice(0, eqIdx);
        rawVal = segment.slice(eqIdx + 1);
      }

      if (rawKey.length > 0) {
        const key = decode(rawKey);
        const val = decode(rawVal);

        if (key in result) {
          if (Array.isArray(result[key])) {
            result[key].push(val);
          } else {
            result[key] = [result[key], val];
          }
        } else {
          result[key] = val;
        }
      }
    }

    i = nextAmp + 1;
    if (nextAmp === str.length) {
      break;
    }
  }

  return result;
}

module.exports = { parseQuery };
