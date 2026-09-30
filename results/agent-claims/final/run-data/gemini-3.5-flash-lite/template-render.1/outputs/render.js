'use strict';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPathValue(data, pathStr) {
  if (!pathStr) return '';
  const parts = pathStr.split('.');
  let curr = data;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '') return '';
    if (curr === null || curr === undefined) return '';
    if (!/^[a-zA-Z0-9_$]+$/.test(part)) return '';
    
    if (typeof curr !== 'object' && typeof curr !== 'function') return '';
    if (Array.isArray(curr)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= curr.length) return '';
      if (!Object.prototype.hasOwnProperty.call(curr, idx)) return '';
      curr = curr[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(curr, part)) return '';
      curr = curr[part];
    }
  }
  return curr;
}

function matchTag(template, pos) {
  const len = template.length;
  if (pos >= len) return null;

  let isTriple = false;
  if (template.startsWith('{{{', pos)) {
    isTriple = true;
  } else if (template.startsWith('{{', pos)) {
    isTriple = false;
  } else {
    return null;
  }

  const posAfter = pos + (isTriple ? 3 : 2);
  const closeStr = isTriple ? '}}}' : '}}';
  const closeIdx = template.indexOf(closeStr, posAfter);
  if (closeIdx === -1) return null;

  const inner = template.slice(posAfter, closeIdx);
  const trimmed = inner.trim();
  
  if (trimmed === '') {
    return null;
  }

  const segments = trimmed.split('.');
  for (const seg of segments) {
    if (seg === '' || !/^[a-zA-Z0-9_$]+$/.test(seg)) {
      return null;
    }
  }

  return {
    path: trimmed,
    raw: isTriple,
    end: closeIdx + (isTriple ? 3 : 2)
  };
}

function render(template, data) {
  if (typeof template !== 'string') {
    throw new TypeError('Template must be a string');
  }
  if (!data || (typeof data !== 'object' && typeof data !== 'function')) {
    throw new TypeError('Data must be a non-null object');
  }

  let result = '';
  let i = 0;
  const len = template.length;

  while (i < len) {
    if (template[i] === '\\' && i + 1 < len) {
      const tagMatch = matchTag(template, i + 1);
      if (tagMatch) {
        result += template.slice(i + 1, tagMatch.end);
        i = tagMatch.end;
        continue;
      }
    }

    const tagMatch = matchTag(template, i);
    if (tagMatch) {
      const { path, raw, end } = tagMatch;
      const val = getPathValue(data, path);
      if (val === null || val === undefined) {
      } else {
        const strVal = String(val);
        result += raw ? strVal : escapeHtml(strVal);
      }
      i = end;
    } else {
      result += template[i];
      i++;
    }
  }

  return result;
}

module.exports = { render };
