'use strict';

function uniqueSlug(base, taken) {
  const list = [...taken];
  const root = base === '' ? 'untitled' : base;
  return list.includes(root) ? `${root}-${list.length + 1}` : root;
}

module.exports = { uniqueSlug };
