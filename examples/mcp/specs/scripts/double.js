'use strict';
// Reads the accepted output of the upstream task and doubles every row.
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
const upstream = JSON.parse(fs.readFileSync(path.join(input.dep_dirs.produce, 'out'), 'utf8'));
fs.writeFileSync('out', JSON.stringify({ rows: upstream.rows.map((n) => n * 2) }));
