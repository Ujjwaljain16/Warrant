'use strict';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function decode(text) {
  return text.replace(/\+/g, ' ').replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    return decoder.decode(bytes);
  });
}

function parseQuery(str) {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  const text = str.startsWith('?') ? str.slice(1) : str;
  const out = Object.create(null);
  for (const segment of text.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawValue = eq === -1 ? '' : segment.slice(eq + 1);
    if (rawKey === '') continue;
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (key in out) {
      if (Array.isArray(out[key])) out[key].push(value);
      else out[key] = [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { parseQuery };
