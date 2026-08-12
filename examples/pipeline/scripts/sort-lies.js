'use strict';
// A worker that claims success (exit 0) but did not sort. Only a content check can tell.
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
fs.copyFileSync(path.join(input.dep_dirs.fetch, 'out'), 'out');
