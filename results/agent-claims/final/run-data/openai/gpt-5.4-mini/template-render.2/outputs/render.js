'use strict';

function render(_template, _data) {
  if (typeof _template !== 'string') {
    throw new TypeError('template must be a string');
  }
  if (_data == null || typeof _data !== 'object') {
    throw new TypeError('data must be a non-null object');
  }

  let result = '';
  let i = 0;

  while (i < _template.length) {
    const start = _template.indexOf('{{', i);
    if (start === -1) {
      result += _template.slice(i);
      break;
    }

    // Append literal text before the tag
    result += _template.slice(i, start);
    i = start;

    // Check for backslash escape
    let escaped = false;
    if (start > 0 && _template[start - 1] === '\\') {
      result += '{'; // literal {
      result += _template.slice(start - 1, start + 1); // {{ or {{{
      i += 2;
      continue;
    }

    // Determine the number of braces
    let braceCount = 0;
    while (i + braceCount < _template.length && _template[i + braceCount] === '{') {
      braceCount++;
    }

    // Tag starts here (after possible escape)
    const tagStart = i;
    const tagEnd = _template.indexOf('}', tagStart + braceCount);
    if (tagEnd === -1) {
      // No closing }, treat as literal
      result += _template.slice(tagStart);
      break;
    }

    const tagContent = _template.slice(tagStart + braceCount, tagEnd).trim();
    const actualBraceCount = braceCount;

    // Determine actual length (1 or 3 braces)
    const isTriple = (actualBraceCount === 3);
    const path = tagContent;

    // Lookup value using dot path
    let value = _data;
    const parts = path.split('.');
    let found = true;
    for (let p of parts) {
      if (value == null) {
        found = false;
        break;
      }
      const key = p;
      if (key === '' || !/^[a-zA-Z0-9_$]+$/.test(key)) {
        found = false;
        break;
      }
      value = value[key];
    }
    if (!found || value === undefined) {
      value = '';
    }

    // Escape if needed
    if (!isTriple) {
      value = String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    result += value;

    // Advance past closing }
    i = tagEnd + 1;
  }

  return result;
}

module.exports = { render };
