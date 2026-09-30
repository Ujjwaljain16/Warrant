'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('documentation: links resolve and the numbers quoted in the docs match the generated reports', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-docs.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
