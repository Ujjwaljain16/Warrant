'use strict';

// Human-readable renderings of the reports the CLI prints. JSON stays the default (scripts and tests read it); `--format text`
// selects these. Nothing here decides anything: every line is a field of the report, laid out for a person.

const MARK = { succeeded: '✔', failed: '✘', unknown: '?', blocked: '○', cancelled: '–', pending: '·', running: '·', verifying: '·' };
const STYLE = { succeeded: 'green', failed: 'red', unknown: 'yellow', blocked: 'dim', cancelled: 'dim' };
const CODES = { green: 32, red: 31, yellow: 33, dim: 2, bold: 1 };

function painter(color) {
  return (style, text) => (color && style && CODES[style] ? `\u001b[${CODES[style]}m${text}\u001b[0m` : text);
}

function detail(task) {
  const v = task.verification;
  if (task.status === 'succeeded') return v && v.passed.length ? `gate passed: ${v.passed.join(', ')}` : 'succeeded';
  if (task.status === 'blocked') return 'never ran: a dependency did not succeed';
  if (task.status === 'cancelled') return task.cancelled_in_flight ? 'cancelled while running' : 'cancelled before it started';
  if (task.status === 'unknown') {
    const open = v && v.not_verified && v.not_verified.length ? `; not verified: ${v.not_verified.join(', ')}` : '';
    return `${task.code}: outcome could not be established${open}`;
  }
  if (v && v.failed && v.failed.length) return `${task.code}: gate failed: ${v.failed.join(', ')}${v.passed.length ? ` (passed: ${v.passed.join(', ')})` : ''}`;
  return task.code || task.status;
}

/** Text for the report of `warrant run` / `warrant resume`. */
function formatRunReport(report, { color = false } = {}) {
  const paint = painter(color);
  const ids = Object.keys(report.tasks);
  const width = Math.max(4, ...ids.map((id) => id.length));
  const lines = [`run ${report.run_id}`];
  for (const id of ids) {
    const task = report.tasks[id];
    const tries = task.attempts === 1 ? '1 attempt ' : `${task.attempts} attempts`;
    const row = `${MARK[task.status] || ' '} ${id.padEnd(width)}  ${task.status.padEnd(9)}  ${tries}  ${detail(task)}`;
    lines.push(paint(STYLE[task.status], row));
  }
  const c = report.counts;
  const summary = ['succeeded', 'failed', 'unknown', 'blocked', 'cancelled'].filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(', ');
  lines.push('', paint(report.status === 'succeeded' ? 'green' : 'red', `${report.status}: ${summary}`));
  const extra = [`${report.attempts} attempts`];
  if (report.duplicates_ignored) extra.push(`${report.duplicates_ignored} duplicate deliveries ignored`);
  if (report.unquiesced_workers) extra.push(`${report.unquiesced_workers} workers did not stop`);
  extra.push(`log ${report.log_entries} entries, head ${String(report.log_head).slice(0, 19)}...`);
  lines.push(paint('dim', extra.join(' | ')));
  return `${lines.join('\n')}\n`;
}

/** Text for the result of `warrant verify-log`. */
function formatVerifyReport(result, { color = false } = {}) {
  const paint = painter(color);
  const lines = [`log entries  ${result.entries}${result.torn_tail ? ' (a torn final line was ignored)' : ''}`];
  lines.push(paint('green', '✔ hash chain  intact: every entry matches its hash and links to the one before'));
  if (result.signature) {
    const s = result.signature;
    lines.push(s.valid
      ? paint(s.unsigned_entries ? 'yellow' : 'green', `✔ signature   valid for head ${String(s.head).slice(0, 19)}... (key ${s.key_id})${s.unsigned_entries ? `; ${s.unsigned_entries} later entries are NOT covered` : ''}`)
      : paint('red', `✘ signature   ${s.reason}`));
  }
  if (!result.invariants_checked) lines.push(paint('dim', '· invariants  not checked (pass --spec <spec.json> to check I1-I8)'));
  else if (!result.violations.length) lines.push(paint('green', '✔ invariants  I1-I8 hold, 0 violations'));
  else {
    lines.push(paint('red', `✘ invariants  ${result.violations.length} violation(s)`));
    for (const v of result.violations.slice(0, 20)) lines.push(paint('red', `    ${v.code}${v.seq !== undefined ? ` at entry ${v.seq}` : ''}: ${v.message}`));
    if (result.violations.length > 20) lines.push(`    ... ${result.violations.length - 20} more (use --format json)`);
  }
  lines.push(paint('dim', `head ${result.head}`));
  return `${lines.join('\n')}\n`;
}

module.exports = Object.freeze({ formatRunReport, formatVerifyReport });
