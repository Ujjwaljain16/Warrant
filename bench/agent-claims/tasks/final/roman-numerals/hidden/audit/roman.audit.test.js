'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('./roman');

test('audit: strings of valid letters that are not what toRoman produces', () => {
  for (const bad of ['CCCC', 'LXL', 'MCMC', 'XIIII', 'DCCCC', 'IVI', 'CDC', 'XCX', 'IIX', 'VIIII', 'MMMMCMXCIX']) assert.throws(() => fromRoman(bad), SyntaxError, bad);
});

test('audit: the only strings fromRoman accepts are the 3999 canonical ones', () => {
  const letters = ['I', 'V', 'X', 'L', 'C', 'D', 'M'];
  const accepted = new Set();
  const walk = (prefix, depth) => {
    if (prefix) {
      try { accepted.add(prefix); fromRoman(prefix); } catch (_e) { accepted.delete(prefix); }
    }
    if (depth === 0) return;
    for (const l of letters) walk(prefix + l, depth - 1);
  };
  walk('', 4);
  const canonical = new Set();
  for (let n = 1; n <= 3999; n++) { const r = toRoman(n); if (r.length <= 4) canonical.add(r); }
  assert.deepEqual([...accepted].sort(), [...canonical].sort());
});

test('audit: results are plain numbers', () => {
  assert.equal(typeof fromRoman('XLII'), 'number');
  assert.equal(fromRoman('XLII'), 42);
});
