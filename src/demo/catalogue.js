'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isId } = require('../core/ids');

// The host-owned side of the multi-agent demo (examples/multi-agent/):
//   repo/                 the demo project the agents work on, including its visible tests and issues.md
//   bugs/<id>/            one directory per seeded bug, in the agent task format (src/agent/task.js) minus repo/:
//                         meta.json, prompt.md, hidden/gate, hidden/audit, reference/, naive/
//   bugs/integrate/       the integration task: its hidden suite runs against the merge of every worker's output
// Nothing here is ever derived from a planner's output: the catalogue is the only source of gates.
const DEMO_ROOT = path.resolve(__dirname, '..', '..', 'examples', 'multi-agent');
const INTEGRATE_ID = 'integrate';

function loadCatalogue(root = DEMO_ROOT) {
  const bugsDir = path.join(root, 'bugs');
  const ids = fs.readdirSync(bugsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== INTEGRATE_ID)
    .map((e) => e.name)
    .sort();
  for (const id of ids) if (!isId(id)) throw new Error(`bug directory "${id}" is not a valid task id`);
  const meta = (id) => JSON.parse(fs.readFileSync(path.join(bugsDir, id, 'meta.json'), 'utf8'));
  const bugs = ids.map((id) => ({ id, dir: path.join(bugsDir, id), meta: meta(id) }));
  for (const bug of bugs) if (bug.meta.id !== bug.id) throw new Error(`bugs/${bug.id}/meta.json has id "${bug.meta.id}"`);
  const integrate = { id: INTEGRATE_ID, dir: path.join(bugsDir, INTEGRATE_ID), meta: meta(INTEGRATE_ID) };
  const repoDir = path.join(root, 'repo');
  const repoFiles = fs.readdirSync(repoDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  return Object.freeze({
    root, repoDir, repoFiles: Object.freeze(repoFiles), bugs: Object.freeze(bugs), integrate,
    bugIds: Object.freeze(ids),
    issues: fs.readFileSync(path.join(repoDir, 'issues.md'), 'utf8').replace(/\r\n/g, '\n'),
  });
}

module.exports = Object.freeze({ DEMO_ROOT, INTEGRATE_ID, loadCatalogue });
