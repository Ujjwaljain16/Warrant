'use strict';

// textkit: the small helpers the other modules in this directory provide, combined.
const { chunk } = require('./chunk');
const { parseLine } = require('./csv');
const { compare } = require('./semver');
const { slugify } = require('./slug');
const { wrap } = require('./wrap');

// "Title One,Title Two" -> ['title-one', 'title-two']
function slugsFromCsv(line) {
  return parseLine(line).map(slugify);
}

// Splits a list into pages of `pageSize` entries.
function pages(items, pageSize) {
  return chunk(items, pageSize);
}

// The newest version of a non-empty list of version strings.
function newest(versions) {
  return versions.reduce((best, v) => (compare(v, best) > 0 ? v : best));
}

// A paragraph wrapped for a fixed-width console.
function banner(text, width) {
  return wrap(text, width);
}

module.exports = { banner, chunk, compare, newest, pages, parseLine, slugify, slugsFromCsv, wrap };
