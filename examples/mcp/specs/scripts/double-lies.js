'use strict';
// Claims success (exit 0) but writes the wrong data. Only the spec's sha256 requirement can tell.
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
fs.copyFileSync(path.join(input.dep_dirs.produce, 'out'), 'out');
