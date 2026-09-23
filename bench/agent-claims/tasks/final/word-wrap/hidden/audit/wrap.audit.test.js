'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('./wrap');

test('audit: width 1 puts each word on its own line', () => {
  assert.deepEqual(wrap('a bb c', 1), ['a', 'bb', 'c']);
});

test('audit: every line respects the width unless it is a single long word, and the words are preserved', () => {
  const text = 'It was the best of times, it was the worst of times, it was the age of wisdom';
  for (const width of [1, 5, 8, 12, 20, 33, 100]) {
    const lines = wrap(text, width);
    for (const line of lines) {
      assert.ok(line.length <= width || !line.includes(' '), `width ${width}: "${line}"`);
      assert.equal(line, line.trim());
      assert.notEqual(line, '');
    }
    assert.equal(lines.join(' '), text);
  }
});

test('audit: greedy, not balanced', () => {
  assert.deepEqual(wrap('aaa bb cccc d', 7), ['aaa bb', 'cccc d']);
});
