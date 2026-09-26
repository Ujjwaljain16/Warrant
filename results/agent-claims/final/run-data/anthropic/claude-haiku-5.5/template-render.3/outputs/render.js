'use strict';

function render(template, data) {
  if (typeof template !== 'string') {
    throw new TypeError('template must be a string');
  }
  if (data === null || typeof data !== 'object') {
    throw new TypeError('data must be a non-null object');
  }

  function getValue(path, data) {
    const parts = path.split('.');
    let current = data;

    for (const part of parts) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }

      if (!Object.prototype.hasOwnProperty.call(current, part)) {
        return undefined;
      }

      current = current[part];
    }

    return current;
  }

  function htmlEscape(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function valueToString(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  }

  function isValidPath(str) {
    if (str.length === 0) return false;
    return /^[a-zA-Z0-9_$]+(\.[a-zA-Z0-9_$]+)*$/.test(str);
  }

  let result = '';
  let i = 0;

  while (i < template.length) {
    if (template[i] === '\\' && i + 1 < template.length && template[i + 1] === '{') {
      result += '{';
      i += 2;
      continue;
    }

    if (template[i] === '{' && template[i + 1] === '{' && template[i + 2] === '{') {
      let j = i + 3;
      let closing = template.indexOf('}}}', j);

      if (closing !== -1) {
        const content = template.substring(j, closing).trim();
        if (isValidPath(content)) {
          const value = getValue(content, data);
          const str = valueToString(value);
          result += str;
          i = closing + 3;
          continue;
        }
      }
    }

    if (template[i] === '{' && template[i + 1] === '{') {
      let j = i + 2;
      let closing = template.indexOf('}}', j);

      if (closing !== -1) {
        const content = template.substring(j, closing).trim();
        if (isValidPath(content)) {
          const value = getValue(content, data);
          const str = valueToString(value);
          result += htmlEscape(str);
          i = closing + 2;
          continue;
        }
      }
    }

    result += template[i];
    i++;
  }

  return result;
}

module.exports = { render };
