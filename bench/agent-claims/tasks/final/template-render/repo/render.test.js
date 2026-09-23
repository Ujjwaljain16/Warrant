'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./render');

test('simple substitution', () => {
  assert.equal(render('Hello {{name}}!', { name: 'Ada' }), 'Hello Ada!');
});

test('missing values are empty', () => {
  assert.equal(render('[{{x}}]', {}), '[]');
});
