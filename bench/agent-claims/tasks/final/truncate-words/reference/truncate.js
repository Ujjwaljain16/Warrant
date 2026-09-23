'use strict';

function truncate(text, max, ellipsis = '…') {
  if (typeof text !== 'string' || typeof ellipsis !== 'string') throw new TypeError('text and ellipsis must be strings');
  if (!Number.isInteger(max) || max < ellipsis.length) throw new RangeError('max must be an integer of at least the ellipsis length');
  if (text.length <= max) return text;
  const limit = max - ellipsis.length;
  let cut = -1;
  for (let i = 1; i < text.length && i <= limit; i++) {
    if (/\s/.test(text[i]) && !/\s/.test(text[i - 1])) cut = i;
  }
  if (cut === -1) return text.slice(0, limit) + ellipsis;
  return text.slice(0, cut) + ellipsis;
}

module.exports = { truncate };
