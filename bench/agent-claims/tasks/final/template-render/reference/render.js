'use strict';

const TAG = /\\?\{\{\{\s*([A-Za-z0-9_$.]+)\s*\}\}\}|\\?\{\{\s*([A-Za-z0-9_$.]+)\s*\}\}/g;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function lookup(data, path) {
  let current = data;
  for (const segment of path.split('.')) {
    if (segment === '' || current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return '';
    current = current[segment];
  }
  return current === null || current === undefined ? '' : String(current);
}

function render(template, data) {
  if (typeof template !== 'string') throw new TypeError('template must be a string');
  if (data === null || typeof data !== 'object') throw new TypeError('data must be an object');
  return template.replace(TAG, (match, raw, escaped) => {
    if (match.startsWith('\\')) return match.slice(1);
    if (raw !== undefined) return lookup(data, raw);
    return lookup(data, escaped).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  });
}

module.exports = { render };
