'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./render');

test('audit: numbers, booleans and arrays are converted with String', () => {
  assert.equal(render('{{n}} {{t}} {{list}}', { n: 3.5, t: true, list: [1, 2] }), '3.5 true 1,2');
});

test('audit: escaping applies after conversion, once', () => {
  assert.equal(render('{{x}}', { x: '&amp;' }), '&amp;amp;');
  assert.equal(render('{{x}}', { x: 1 < 2 }), 'true');
});

test('audit: names with $ and _ and digits', () => {
  assert.equal(render('{{$a}} {{_b}} {{c1}}', { $a: 1, _b: 2, c1: 3 }), '1 2 3');
});

test('audit: a stray closing brace after a tag stays', () => {
  assert.equal(render('{{a}}}', { a: 'x' }), 'x}');
});

test('audit: array of objects by index', () => {
  assert.equal(render('{{rows.1.id}}', { rows: [{ id: 'a' }, { id: 'b' }] }), 'b');
});

test('audit: data keys that are inherited from Object.prototype but also own', () => {
  assert.equal(render('{{toString}}', { toString: 'mine' }), 'mine');
});
