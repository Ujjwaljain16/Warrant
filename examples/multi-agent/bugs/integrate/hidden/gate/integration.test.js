'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { banner, newest, pages, slugsFromCsv } = require('./index');

test('titles from a CSV line become slugs', () => {
  assert.deepEqual(slugsFromCsv('"Hello, World",Café Münster,  Top 10 '), ['hello-world', 'cafe-munster', 'top-10']);
});

test('slugs are paged without losing the last page', () => {
  const slugs = slugsFromCsv('One,Two,Three,Four,Five');
  assert.deepEqual(pages(slugs, 2), [['one', 'two'], ['three', 'four'], ['five']]);
  assert.throws(() => pages(slugs, 0), RangeError);
});

test('the newest version wins, numerically and across pre-releases', () => {
  assert.equal(newest(['1.9.0', '1.10.0', '1.2.0-rc.1']), '1.10.0');
  assert.equal(newest(['1.0.0-alpha', '1.0.0']), '1.0.0');
  assert.equal(newest(['2.0.0-beta.2', '2.0.0-beta.11']), '2.0.0-beta.11');
});

test('a banner never exceeds the console width', () => {
  const out = banner('release notes for the newest textkit version', 12);
  assert.equal(out, 'release\nnotes for\nthe newest\ntextkit\nversion');
});

test('a quoted title with a quote survives the whole pipeline', () => {
  assert.deepEqual(slugsFromCsv('"The ""Best"" of 2024",x'), ['the-best-of-2024', 'x']);
});
