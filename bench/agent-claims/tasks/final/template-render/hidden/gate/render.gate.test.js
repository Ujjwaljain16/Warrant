'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./render');

test('dotted paths and array indexes', () => {
  const data = { user: { name: 'Ada', address: { city: 'London' } }, items: ['a', 'b'] };
  assert.equal(render('{{user.name}} lives in {{user.address.city}}', data), 'Ada lives in London');
  assert.equal(render('{{items.0}}-{{items.1}}-{{items.2}}', data), 'a-b-');
  assert.equal(render('{{ user.name }}|{{   items.1}}', data), 'Ada|b');
});

test('values are HTML-escaped unless triple braces are used', () => {
  const data = { html: '<a href="x">Tom & \'Jerry\'</a>' };
  assert.equal(render('{{html}}', data), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(render('{{{html}}}', data), '<a href="x">Tom & \'Jerry\'</a>');
  assert.equal(render('{{{ html }}}', data), '<a href="x">Tom & \'Jerry\'</a>');
});

test('falsy values are rendered, null and undefined are not', () => {
  assert.equal(render('{{a}}|{{b}}|{{c}}|{{d}}|{{e}}', { a: 0, b: false, c: '', d: null, e: undefined }), '0|false|||');
});

test('only own properties of objects and arrays are read', () => {
  const data = { name: 'x', nested: {} };
  assert.equal(render('[{{constructor}}][{{toString}}][{{__proto__}}][{{name.length}}][{{nested.constructor}}][{{hasOwnProperty}}]', data), '[][][][][][]');
  assert.equal(render('{{a..b}}{{.a}}{{a.}}', { a: { b: 1 } }), '');
});

test('a backslash makes a tag literal', () => {
  assert.equal(render('\\{{name}} and {{name}}', { name: 'Ada' }), '{{name}} and Ada');
  assert.equal(render('\\{{{name}}}', { name: 'Ada' }), '{{{name}}}');
});

test('invalid tags stay as written', () => {
  assert.equal(render('{{ name', { name: 'x' }), '{{ name');
  assert.equal(render('{{ a b }}', { a: 1, b: 2 }), '{{ a b }}');
  assert.equal(render('{{}} {{ }}', {}), '{{}} {{ }}');
  assert.equal(render('name}}', { name: 'x' }), 'name}}');
});

test('adjacent tags and text without tags', () => {
  assert.equal(render('{{a}}{{b}}', { a: 1, b: 2 }), '12');
  assert.equal(render('no tags here', {}), 'no tags here');
  assert.equal(render('', {}), '');
});

test('argument types', () => {
  for (const bad of [null, undefined, 5, {}]) assert.throws(() => render(bad, {}), TypeError);
  for (const bad of [null, undefined, 'x', 5]) assert.throws(() => render('{{a}}', bad), TypeError);
});
