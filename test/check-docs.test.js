'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-docs.js');

function run(root) {
  const env = { ...process.env };
  if (root) env.WARRANT_DOCS_ROOT = root; else delete env.WARRANT_DOCS_ROOT;
  return spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
}

test('documentation: links resolve and the numbers quoted in the docs match the generated reports', () => {
  const result = run(null);
  assert.equal(result.status, 0, result.stderr);
});

// The check is only worth having if it fails when the documentation drifts. Copy the repository without its bulky
// run data, break one thing at a time, and require the right complaint.
test('documentation: the check fails on a changed headline number, a broken link and a contradictory phrase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warrant-docs-'));
  try {
    const skip = new Set(['.git', 'node_modules', '.warrant', 'run-data', 'cassettes', 'raw.jsonl.gz']);
    fs.cpSync(REPO, root, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
    const readme = path.join(root, 'README.md');
    const original = fs.readFileSync(readme, 'utf8');

    assert.equal(run(root).status, 0, 'the unmodified copy must pass, or the mutations below prove nothing');

    const cases = [
      ['a changed headline number', original.replace('3.9% (3 of 77)', '4.9% (3 of 77)'), /gate accepted/],
      ['a broken link', `${original}\n[x](docs/does-not-exist.md)\n`, /broken link/],
      ['a contradictory phrase', `${original}\nThere is no model-provider abstraction.\n`, /stale or contradictory phrase/],
    ];
    for (const [name, mutated, complaint] of cases) {
      assert.notEqual(mutated, original, `the mutation for ${name} did not change the README`);
      fs.writeFileSync(readme, mutated);
      const result = run(root);
      assert.equal(result.status, 1, `${name} should fail the check`);
      assert.match(result.stderr, complaint, name);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
