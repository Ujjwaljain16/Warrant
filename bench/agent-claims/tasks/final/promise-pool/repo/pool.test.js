'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('./pool');

test('results are in input order', async () => {
  const out = await pool([30, 10, 20], async (ms, i) => { await new Promise((r) => setTimeout(r, ms)); return i; }, 2);
  assert.deepEqual(out, [0, 1, 2]);
});

test('an empty list', async () => {
  assert.deepEqual(await pool([], async () => 1, 3), []);
});
