'use strict';
// Stand-in for "fetch some data": deterministic so the spec can pin the expected digest.
require('node:fs').writeFileSync('out', JSON.stringify({ rows: [5, 3, 9, 1] }));
