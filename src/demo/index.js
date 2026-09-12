'use strict';

const catalogue = require('./catalogue');
const materialize = require('./materialize');
const orchestrate = require('./orchestrate');
const plan = require('./plan');
const report = require('./report');
const spec = require('./spec');
const worker = require('./worker');
const live = require('./live');

// Problems that would make the demo's claim ("the gates decide what counts as done") false for this report.
function reportProblems(r) {
  const problems = [];
  if (r.status !== 'completed') return [`demo did not run: ${r.status}`];
  for (const [mode, m] of Object.entries(r.modes)) {
    if (m.invariant_violations.length) problems.push(`${mode}: engine invariants violated: ${m.invariant_violations.join('; ')}`);
    if (m.shipped_integration.status === 'error') problems.push(`${mode}: integration suite could not be evaluated`);
    for (const [id, status] of Object.entries(m.audit)) if (status === 'error') problems.push(`${mode}: audit of ${id} could not be evaluated`);
  }
  for (const [mode, m] of Object.entries(r.modes)) {
    for (const [id, t] of Object.entries(m.tasks)) {
      if (t.agent.some((a) => a.outcome === 'llm_error' || a.outcome === 'quota_exhausted')) problems.push(`${mode}: the model could not answer for ${id} (on replay: a cassette miss)`);
    }
  }
  const gated = r.modes.gated;
  if (gated) {
    if (gated.false_acceptances.length) problems.push(`gated accepted wrong work: ${gated.false_acceptances.join(', ')}`);
    if (gated.false_success) problems.push('gated reported a false success');
  }
  return problems;
}

module.exports = Object.freeze({
  ...catalogue, ...materialize, ...orchestrate, ...plan, ...report, ...spec, ...worker, ...live, reportProblems,
});
