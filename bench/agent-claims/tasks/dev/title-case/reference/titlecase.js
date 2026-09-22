'use strict';

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

function capitalize(part) {
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function titleCase(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const parts = text.split(/(\s+)/);
  const isWord = (p) => p !== '' && !/^\s+$/.test(p);
  const wordIndexes = parts.map((p, i) => (isWord(p) ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0];
  const last = wordIndexes[wordIndexes.length - 1];
  return parts.map((p, i) => {
    if (!isWord(p)) return p;
    if (i !== first && i !== last && SMALL.has(p.toLowerCase())) return p.toLowerCase();
    return p.split('-').map(capitalize).join('-');
  }).join('');
}

module.exports = { titleCase };
