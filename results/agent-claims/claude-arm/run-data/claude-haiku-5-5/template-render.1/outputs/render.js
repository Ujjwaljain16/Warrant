'use strict';

// Tag contents: names (letters, digits, _, $) joined by dots, optionally
// padded with spaces. Path segments are validated during lookup, so
// odd paths such as `a..b` are well-formed tags that resolve to nothing.
const CONTENT = '[A-Za-z0-9_$.]+';
const TRIPLE_TAG = new RegExp('\\{\\{\\{ *(' + CONTENT + ') *\\}\\}\\}', 'y');
const DOUBLE_TAG = new RegExp('\\{\\{ *(' + CONTENT + ') *\\}\\}', 'y');
const NAME = /^[A-Za-z0-9_$]+$/;

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

// Returns the value at a dotted path, or undefined when the path is missing.
// Only own properties of objects and arrays are reachable.
function lookup(data, path) {
  let current = data;
  for (const segment of path.split('.')) {
    if (!NAME.test(segment)) return undefined;
    if (!isContainer(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function stringify(path, data) {
  const value = lookup(data, path);
  if (value === undefined || value === null) return '';
  return String(value);
}

function matchTagAt(template, index) {
  for (const re of [TRIPLE_TAG, DOUBLE_TAG]) {
    re.lastIndex = index;
    const m = re.exec(template);
    if (m) return { raw: m[0], path: m[1], triple: re === TRIPLE_TAG };
  }
  return null;
}

function render(template, data) {
  if (typeof template !== 'string') {
    throw new TypeError('template must be a string');
  }
  if (!isContainer(data)) {
    throw new TypeError('data must be a non-null object');
  }

  let out = '';
  let i = 0;
  while (i < template.length) {
    // A backslash directly before a valid tag makes the tag literal.
    if (template[i] === '\\') {
      const tag = matchTagAt(template, i + 1);
      if (tag) {
        out += tag.raw;
        i += 1 + tag.raw.length;
        continue;
      }
    }

    const tag = matchTagAt(template, i);
    if (tag) {
      const text = stringify(tag.path, data);
      out += tag.triple ? text : escapeHtml(text);
      i += tag.raw.length;
      continue;
    }

    out += template[i];
    i += 1;
  }
  return out;
}

module.exports = { render };
