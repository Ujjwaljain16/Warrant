#!/usr/bin/env node
'use strict';

// Regenerates bench/data/workloads-v1.json from the generator. CI/tests check the stored file equals regeneration,
// so the dataset cannot drift from the code that defines it.
const fs = require('node:fs');
const path = require('node:path');
const { DATASET_VERSION, GENERATOR_SEED, allWorkloads } = require('../src/bench/workloads');

function build() {
  return {
    dataset_version: DATASET_VERSION,
    generator_seed: GENERATOR_SEED,
    workloads: allWorkloads().map((w) => ({
      id: w.id, critical_path_ms: w.critical_path_ms, fail_task: w.fail_task, nonrepeatable: w.nonrepeatable, expected: w.expected, spec: w.spec,
    })),
  };
}

if (require.main === module) {
  const file = path.resolve(__dirname, '..', 'bench', 'data', `${DATASET_VERSION}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(build(), null, 1)}\n`);
  process.stdout.write(`wrote ${file}\n`);
}

module.exports = { build };
