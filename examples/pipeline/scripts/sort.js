'use strict';
// Reads the gate-accepted output of `fetch` and sorts it.
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
const { rows } = JSON.parse(fs.readFileSync(path.join(input.dep_dirs.fetch, 'out'), 'utf8'));
fs.writeFileSync('out', JSON.stringify({ rows: [...rows].sort((a, b) => a - b) }));
