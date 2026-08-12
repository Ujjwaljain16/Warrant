'use strict';
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
const { rows } = JSON.parse(fs.readFileSync(path.join(input.dep_dirs.sort, 'out'), 'utf8'));
fs.writeFileSync('out', JSON.stringify({ count: rows.length, max: rows[rows.length - 1] }));
