'use strict';

// Plain-language reading of a verified log: what it establishes and, just as important, what it cannot.
// Pure text generation from the model, the chain result and the audit; no log string is interpreted as markup
// (the page sets these with textContent).

const { clip } = require('./text');

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function summarize({ model, counts, chain, violations, hasSpec, specMatch, name }) {
  const tasks = model.tasks.size;
  const statuses = counts.byStatus;
  const got = (s) => statuses.get(s) || 0;
  const finished = model.global.finished;
  const chainBroken = chain.status === 'broken';
  const chainOk = chain.status === 'valid';
  const clean = chainOk && violations.length === 0;

  const facts = [];
  facts.push(`${plural(tasks, 'task', 'tasks')}, ${plural(counts.attempts, 'attempt', 'attempts')} in ${plural(model.eventCount, 'logged event', 'logged events')}.`);
  const parts = ['succeeded', 'failed', 'unknown', 'blocked', 'cancelled', 'running', 'pending'].filter((s) => got(s) > 0).map((s) => `${got(s)} ${s}`);
  if (parts.length) facts.push(`Final task states: ${parts.join(', ')}.`);
  if (counts.rejected) facts.push(`The gate rejected ${plural(counts.rejected, 'attempt', 'attempts')} whose worker had claimed success: the claim was checked against the requirements and did not hold.`);
  if (counts.crashed) facts.push(`${plural(counts.crashed, 'attempt', 'attempts')} crashed or timed out.`);
  if (counts.reconciles) facts.push(`${plural(counts.reconciles, 'ambiguous attempt', 'ambiguous attempts')} resolved by asking the worker side what actually happened (reconcile) instead of guessing.`);
  if (counts.duplicates) facts.push(`${plural(counts.duplicates, 'duplicate or late delivery', 'duplicate or late deliveries')} ignored, not applied twice.`);
  if (model.global.cancel) facts.push(`Cancellation was requested${model.global.cancel.reason ? ` (${clip(model.global.cancel.reason, 60)})` : ''}; nothing started afterwards.`);
  if (model.global.resumed) facts.push('This run was resumed from an earlier log after an interruption.');
  if (!finished) facts.push('There is no run_finished entry: the run was still going, was interrupted, or the log ends early.');
  else facts.push(`The engine reports the run as ${clip(finished.status, 30)}.`);

  const proves = [];
  const notProves = [];

  if (chainOk) {
    proves.push(`The ${plural(chain.total, 'entry', 'entries')} are in order and unchanged since they were written: each commits to its own content and to the one before it, and the sequence has no gap. Editing, deleting or reordering any entry would have broken the chain.${chain.torn ? ' (An unfinished last line was ignored, as the engine itself does.)' : ''}`);
  } else if (chainBroken) {
    proves.push('Nothing beyond the intact prefix: the chain breaks, so entries from the break onward may have been altered, reordered or removed. Treat them as untrusted.');
  } else {
    proves.push('Nothing: the log is empty.');
  }
  if (!chainBroken && chain.total > 0) {
    const v = (code) => violations.some((x) => x.code === code);
    if (!v('I1_UNVERIFIED_SUCCESS')) {
      const ok = got('succeeded');
      proves.push(ok ? `Every one of the ${plural(ok, 'succeeded task', 'succeeded tasks')} has a recorded gate verdict that passed, for the same attempt and the same artifact digest. Success is never recorded on the worker's word alone (I1).` : 'No task is recorded as succeeded without a passing verdict (I1).');
    }
    if (!v('I4_START_AFTER_TERMINAL') && !v('I4_TERMINAL_CHANGED')) proves.push('No task was restarted or re-settled after reaching a final state (I4).');
    if (!v('I6_DOUBLE_INGEST')) proves.push('No attempt result was applied more than once (I6).');
    if (!v('I7_START_AFTER_CANCEL')) proves.push('No attempt started after cancellation was requested (I7).');
    if (hasSpec) {
      if (!v('I2_DEP_NOT_SUCCEEDED')) proves.push('Every attempt started only after all the tasks it depends on had succeeded (I2).');
      if (!v('I3_ATTEMPT_BUDGET') && !v('I3_CONCURRENCY')) proves.push('Attempt budgets and the concurrency cap were respected (I3).');
      if (!v('I5_NONREPEATABLE_RESTART')) proves.push('No one-shot external effect was repeated unless a reconcile showed the earlier attempt had not applied (I5).');
    }
  }
  for (const x of violations.filter((y) => y.code !== 'I8_CHAIN').slice(0, 6)) {
    notProves.push(`Violation ${x.code}${x.seq ? ` at entry ${x.seq}` : ''}: ${clip(x.message, 160)}. The engine's own guarantees did not hold for this log, or the log was edited and re-hashed.`);
  }

  notProves.push('Who wrote it. The chain is tamper-evident, not signed: someone who rewrites an entry can recompute every later hash. "Valid" means internally consistent, not authentic. Compare the head hash with one you got from a source you trust.');
  notProves.push('That nothing is missing at the end. Cutting entries off the tail, or a torn last line, leaves a chain that still verifies.');
  notProves.push('That the work itself is good. The log stores digests of artifacts, not the artifacts, and a passing verdict is only as strong as the requirements that were written for the task.');
  if (counts.claimOnly) notProves.push(`${plural(counts.claimOnly, 'succeeded task', 'succeeded tasks')} had no requirements (claim-only): they were accepted on the worker's word by explicit choice, so nothing was checked.`);
  const unverifiedTasks = [...model.tasks.values()].filter((t) => t.status === 'unknown' || t.notVerified.length).length;
  if (unverifiedTasks) notProves.push(`${plural(unverifiedTasks, 'task', 'tasks')} ended with requirements that could not be verified; the log names which.`);
  if (!hasSpec) notProves.push('Dependencies, attempt budgets, the concurrency cap and one-shot effects (I2, I3, I5) were not checked: load the run spec JSON to check them.');
  if (hasSpec && specMatch === false) notProves.push('The spec you loaded does not match the spec digest recorded in the log, so the spec-based checks describe a different run definition.');
  notProves.push('Wall-clock timing. The t field is whatever clock the writer used; it is shown but not trusted.');

  let headline;
  let tone;
  if (chainBroken) {
    headline = `${name ? `${clip(name, 60)}: ` : ''}the hash chain is broken at entry ${chain.broken.index}. Do not trust this log past that point.`;
    tone = 'bad';
  } else if (violations.length) {
    headline = `${name ? `${clip(name, 60)}: ` : ''}the chain verifies, but ${plural(violations.length, 'invariant violation', 'invariant violations')} ${violations.length === 1 ? 'was' : 'were'} found. This log was not produced by a correct engine, or it was rewritten and re-hashed.`;
    tone = 'bad';
  } else if (chain.status === 'empty') {
    headline = 'The log is empty.';
    tone = 'warn';
  } else {
    const allOk = tasks > 0 && got('succeeded') === tasks;
    headline = `${name ? `${clip(name, 60)}: ` : ''}${allOk ? `all ${plural(tasks, 'task', 'tasks')} succeeded` : `${got('succeeded')} of ${plural(tasks, 'task', 'tasks')} succeeded`}${counts.rejected ? `, and the gate caught ${plural(counts.rejected, 'false claim', 'false claims')} on the way` : ''}. The chain verifies and the checked invariants hold.`;
    tone = allOk || clean ? 'good' : 'warn';
    if (!allOk) tone = 'warn';
  }
  return { headline, tone, facts, proves, notProves };
}

module.exports = { summarize };
