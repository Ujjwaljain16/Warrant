'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIni } = require('./ini');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('top-level keys and a section', () => {
  const text = 'name = demo\n[server]\nhost = localhost\nport = 8080\n';
  assert.deepEqual(plain(parseIni(text)), { name: 'demo', server: { host: 'localhost', port: '8080' } });
});

test('comments and blank lines are ignored', () => {
  assert.deepEqual(plain(parseIni('; note\n\n# other\na = 1\n')), { a: '1' });
});
