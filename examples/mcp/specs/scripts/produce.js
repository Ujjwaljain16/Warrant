'use strict';
// Stand-in for "produce some data": deterministic, so the spec can pin the expected digest.
require('node:fs').writeFileSync('out', JSON.stringify({ rows: [3, 1, 2] }));
