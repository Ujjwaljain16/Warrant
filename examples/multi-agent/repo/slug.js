'use strict';

// Turns a title into a URL slug.
function slugify(text) {
  return text.toLowerCase().replace(/ /g, '-');
}

module.exports = { slugify };
