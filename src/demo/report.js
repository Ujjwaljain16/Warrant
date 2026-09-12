'use strict';

// Markdown rendering of the side-by-side report. Pure: the same report object always gives the same text.
const verdict = (s) => (s === 'pass' ? 'PASS' : s === 'fail' ? 'FAIL' : String(s).toUpperCase());

function ungatedCell(cell) {
  if (!cell) return 'n/a';
  if (cell.accepted) return `accepted on its claim; hidden audit **${verdict(cell.audit)}**`;
  return `not accepted (${cell.code})`;
}

function gatedCell(cell) {
  if (!cell) return 'n/a';
  return cell.accepted ? `accepted: gate passed (${cell.code})` : `**${cell.status}** (${cell.code})`;
}

function planLines(plan) {
  const lines = [];
  if (!plan.accepted) lines.push(`- Plan **rejected** after ${plan.rounds} round(s); nothing was run.`);
  else lines.push(`- Plan accepted in round ${plan.rounds}: ${plan.subtasks.map((s) => `\`${s.id}\``).join(', ')}${plan.uncovered.length ? `; not covered: ${plan.uncovered.join(', ')}` : ''}.`);
  for (const r of plan.rejected) {
    lines.push(`- Round ${r.round} rejected by the host validator: ${r.errors.slice(0, 6).map((e) => `\`${e.at}\` ${e.code}`).join(', ')}${r.errors.length > 6 ? ', ...' : ''}.`);
  }
  return lines;
}

function toMarkdown(report) {
  const out = [`# Multi-agent demo: scenario \`${report.scenario}\``, '', `Agents: \`${report.model}\`. Gates, retry budget (${report.host_policy.workerMaxAttempts} attempts per task), concurrency (${report.host_policy.maxConcurrency}) and deadlines come from the host, not from the planner.`, '', '## Planner', '', ...planLines(report.plan), ''];
  if (report.status === 'plan_rejected') return `${out.join('\n')}\n`;
  const { gated, ungated } = report.modes;
  if (gated && ungated) {
    out.push('## Per bug', '', '| bug | agent said | ungated (trusts the claim) | gated (warrant) |', '|---|---|---|---|');
    for (const row of report.comparison) out.push(`| \`${row.id}\` | ${row.agent_claim || `no claim (${row.agent_outcome})`} | ${ungatedCell(row.ungated)} | ${gatedCell(row.gated)} |`);
    out.push('');
  }
  const col = (fn) => ['ungated', 'gated'].map((m) => (report.modes[m] ? fn(report.modes[m]) : 'n/a'));
  const rows = [
    ['tasks accepted', (m) => `${m.accepted.length} of ${Object.keys(m.tasks).filter((id) => id !== 'integrate').length}`],
    ['accepted but wrong (hidden audit fails)', (m) => String(m.false_acceptances.length)],
    ['run reported', (m) => `${m.run_status}${m.reported_success ? ' (success)' : ''}`],
    ['false success reported', (m) => (m.false_success ? '**YES**' : 'no')],
    ['hidden integration suite on what was shipped', (m) => verdict(m.shipped_integration.status)],
    ['engine attempts / model calls', (m) => `${m.engine_attempts} / ${m.agent_usage.calls}`],
    ['log entries (hash-chained)', (m) => String(m.log_entries)],
  ];
  out.push('## Outcome', '', '| | ungated | gated |', '|---|---|---|');
  for (const [label, fn] of rows) out.push(`| ${label} | ${col(fn).join(' | ')} |`);
  out.push('', 'Hidden audit = the host\'s gate suite plus extra stricter tests, run only to judge the result; no agent and no orchestrator sees it. "Ungated" runs the same agents and the same recorded model replies, but a task counts as done when the worker says so. Open `gated/run.log` or `ungated/run.log` in `viewer/run-viewer.html`.', '');
  return out.join('\n');
}

module.exports = Object.freeze({ toMarkdown });
