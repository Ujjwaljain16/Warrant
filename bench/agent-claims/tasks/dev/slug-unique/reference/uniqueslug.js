'use strict';

function uniqueSlug(base, taken) {
  if (typeof base !== 'string') throw new TypeError('base must be a string');
  if (!Array.isArray(taken) && !(taken instanceof Set)) throw new TypeError('taken must be an array or a Set');
  const used = new Set(taken);
  const root = base === '' ? 'untitled' : base;
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

module.exports = { uniqueSlug };
