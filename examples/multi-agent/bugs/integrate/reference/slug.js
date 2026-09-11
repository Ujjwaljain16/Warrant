'use strict';

// Turns a title into a URL slug.
function slugify(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
