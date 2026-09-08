'use strict';

// Static panels: verdict banner, summary, task table, task detail, invariants, event table, entry dialog.
// Everything is built with dom.h(): text only, no markup from the log.

const { clear, h } = require('./dom');
const { icon, kindView, statusView } = require('./icons');
const { clip } = require('./text');
const { describeEvent, formatT, shortHash } = require('./describe');
const { EVENT_TYPES } = require('./states');
const { computeEntryHash } = require('./chain');
const { hashBackend } = require('./canonical');

function chip(tone, iconName, text, title) {
  return h('span', { class: `chip tone-${tone}`, title }, iconName ? icon(iconName, 13) : null, h('span', null, text));
}

function statusChip(status) {
  const v = statusView(status);
  return chip(v.tone, v.icon, v.label);
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// ------------------------------------------------------------------ banner

function renderBanner(host, a, source) {
  clear(host);
  const { chain, parsed } = a;
  let tone;
  let iconName;
  let title;
  if (chain.status === 'broken') { tone = 'bad'; iconName = 'unlink'; title = `Chain broken at entry ${chain.broken.index}`; }
  else if (chain.status === 'empty') { tone = 'warn'; iconName = 'question'; title = 'Empty log'; }
  else if (chain.torn) { tone = 'ok'; iconName = 'link'; title = 'Chain valid · torn final line tolerated'; }
  else { tone = 'ok'; iconName = 'link'; title = 'Chain valid'; }

  host.setAttribute('class', `banner tone-${tone}`);
  const badge = h('div', { class: 'badge', role: 'status' }, icon(iconName, 22), h('span', { class: 'badge-text' }, title));
  const lead = h('p', { class: 'headline' }, a.summary.headline);
  const facts = h('dl', { class: 'facts' });
  const add = (k, v, mono) => { facts.appendChild(h('div', null, h('dt', null, k), h('dd', { class: mono ? 'mono' : null }, v))); };
  add('Source', source);
  add('Entries', chain.status === 'broken' ? `${chain.verified} verified of ${plural(chain.total, 'entry', 'entries')} read` : plural(chain.total, 'entry', 'entries'));
  if (chain.head && chain.status !== 'broken') add('Head hash', clip(chain.head, 80), true);
  add('Checked with', `SHA-256 over canonical JSON, ${hashBackend() === 'webcrypto' ? 'WebCrypto' : 'built-in JavaScript SHA-256 (WebCrypto is unavailable in this context)'}, in this browser`);
  host.appendChild(badge);
  host.appendChild(lead);

  if (chain.status === 'broken') {
    const b = chain.broken;
    const why = h('div', { class: 'why' },
      h('p', null, h('strong', null, 'Why: '), clip(b.message, 400)),
      h('p', null, `Line ${b.line === undefined ? '?' : b.line} of the file. Entries 1–${chain.verified} verified; entry ${b.index} and everything after it is not trusted and is drawn hatched.`));
    if (b.expectedHash && b.storedHash && b.expectedHash !== b.storedHash) {
      why.appendChild(h('p', { class: 'mono small' }, `stored     ${clip(b.storedHash, 80)}`));
      why.appendChild(h('p', { class: 'mono small' }, `recomputed ${clip(b.expectedHash, 80)}`));
    }
    host.appendChild(why);
  }
  host.appendChild(facts);

  const notes = [];
  if (chain.torn) notes.push(['warn', `Line ${chain.torn.line} is an unfinished final line (${chain.torn.chars} characters) and was ignored, exactly as the engine does when it reopens a log.`]);
  if (parsed.problems.length > 1) notes.push(['warn', `${parsed.problems.length} lines could not be read as JSON (first: line ${parsed.problems[0].line}).`]);
  if (parsed.bom) notes.push(['mute', 'A byte-order mark at the start of the file was ignored.']);
  if (parsed.truncated) notes.push(['warn', `Only the first ${a.limits.maxEntries.toLocaleString('en-US')} entries were read; the file has more.`]);
  if (a.specError) notes.push(['bad', `The spec file was not used: ${clip(a.specError, 160)}.`]);
  if (a.spec && a.specMatch === false) notes.push(['bad', 'The spec you loaded is not the one this run recorded (its digest differs from the log’s run_started entry).']);
  if (a.spec && a.specMatch === true) notes.push(['ok', 'The loaded spec matches the digest recorded in the log.']);
  if (notes.length) host.appendChild(h('ul', { class: 'notes' }, notes.map(([t, text]) => h('li', { class: `tone-${t}` }, icon(t === 'ok' ? 'check' : t === 'bad' ? 'cross' : 'bang', 14), h('span', null, text)))));
}

// ------------------------------------------------------------------ summary

function renderSummary(host, a) {
  clear(host);
  const { summary } = a;
  host.appendChild(h('ul', { class: 'facts-list' }, summary.facts.map((f) => h('li', null, f))));
  host.appendChild(h('div', { class: 'two-col' },
    h('div', { class: 'col proves' }, h('h3', null, icon('check', 16), 'What this log proves'), h('ul', null, summary.proves.map((t) => h('li', null, t)))),
    h('div', { class: 'col notproves' }, h('h3', null, icon('question', 16), 'What it does not prove'), h('ul', null, summary.notProves.map((t) => h('li', null, t))))));
}

// ------------------------------------------------------------------ tasks

function requirementChips(task) {
  const v = task.verdict;
  const chips = [];
  if (!v) {
    if (task.def && Array.isArray(task.def.requirements)) for (const r of task.def.requirements.slice(0, 12)) if (r && typeof r.id === 'string') chips.push(chip('mute', 'dot', `${clip(r.id, 24)}: no verdict`));
    return chips;
  }
  v.passed.forEach((id) => chips.push(chip('ok', 'check', `${clip(id, 24)} passed`)));
  v.failed.forEach((id) => chips.push(chip('bad', 'cross', `${clip(id, 24)} FAILED`)));
  v.notVerified.forEach((id) => chips.push(chip('warn', 'question', `${clip(id, 24)} not verified`)));
  if (v.claimOnly) chips.push(chip('warn', 'bang', 'claim-only: nothing checked'));
  if (task.def && Array.isArray(task.def.requirements)) {
    const seen = new Set([...v.passed, ...v.failed, ...v.notVerified]);
    for (const r of task.def.requirements.slice(0, 32)) if (r && typeof r.id === 'string' && !seen.has(r.id)) chips.push(chip('mute', 'dot', `${clip(r.id, 24)}: no verdict`));
  }
  return chips;
}

function renderTasks(host, a, selected, onSelect) {
  clear(host);
  const { model } = a;
  const body = h('tbody');
  for (const id of model.taskOrder) {
    const task = model.tasks.get(id);
    const maxAttempts = task.def && Number.isInteger(task.def.max_attempts) ? ` / ${task.def.max_attempts}` : '';
    const tr = h('tr', { class: selected === id ? 'selected' : null, 'aria-current': selected === id ? 'true' : null },
      h('th', { scope: 'row', 'data-label': 'Task' }, h('button', { type: 'button', class: 'linklike', listeners: { click: () => onSelect(id) } }, clip(id, 60))),
      h('td', { 'data-label': 'Final status' }, statusChip(task.finalStatus), task.maybeApplied ? chip('warn', 'bang', 'effect may have applied') : null),
      h('td', { 'data-label': 'Attempts' }, `${task.attempts}${maxAttempts}`),
      h('td', { 'data-label': 'Code', class: 'mono' }, task.code ? clip(task.code, 40) : '—'),
      h('td', { 'data-label': 'Requirements', class: 'chips' }, requirementChips(task)));
    body.appendChild(tr);
  }
  host.appendChild(h('table', { class: 'data tasks' },
    h('caption', null, 'One row per task: final state, attempts used, and what the gate established about each requirement'),
    h('thead', null, h('tr', null, ['Task', 'Final status', 'Attempts', 'Code', 'Requirements (from the last gate verdict)'].map((t) => h('th', { scope: 'col' }, t)))),
    body));
}

// ------------------------------------------------------------------ task detail

function renderTaskDetail(host, a, taskId, onOpenEvent, onFilterTask) {
  clear(host);
  const { model } = a;
  const task = taskId === null ? null : model.tasks.get(taskId);
  if (!task) { host.appendChild(h('p', { class: 'muted' }, 'Select a task in the timeline or the table to see its attempts and state transitions.')); return; }

  const def = task.def;
  const meta = h('dl', { class: 'facts' });
  const add = (k, v) => meta.appendChild(h('div', null, h('dt', null, k), h('dd', null, v)));
  add('Final status', statusChip(task.finalStatus));
  add('Attempts', `${task.attempts}${def && Number.isInteger(def.max_attempts) ? ` of ${def.max_attempts} allowed` : ''}`);
  if (task.code) add('Code', clip(task.code, 60));
  if (def) {
    add('Effect class', clip(String(def.effect), 40));
    add('Depends on', Array.isArray(def.deps) && def.deps.length ? def.deps.map((d) => clip(String(d), 30)).join(', ') : 'nothing');
  }
  if (task.unknown) add('Spec', chip('bad', 'cross', 'not declared in the loaded spec'));

  host.appendChild(h('div', { class: 'detail-head' },
    h('h3', null, clip(task.id, 80)),
    h('button', { type: 'button', class: 'btn small', listeners: { click: () => onFilterTask(task.id) } }, 'Show only its events')));
  host.appendChild(meta);

  // State flow: pending -> running -> ...
  host.appendChild(h('h4', null, 'State transitions'));
  const flow = h('ol', { class: 'flow', 'aria-label': `State path of task ${clip(task.id, 40)}` });
  const startView = statusView('pending');
  flow.appendChild(h('li', null, h('span', { class: `state tone-${startView.tone}` }, icon(startView.icon, 14), 'pending')));
  for (const tr of task.transitions) {
    const v = statusView(tr.to);
    flow.appendChild(h('li', null,
      h('span', { class: `arrow ${tr.legal ? '' : 'illegal'}`, 'aria-hidden': 'true' }, tr.legal ? '→' : '⇢'),
      h('span', { class: `state tone-${v.tone}${tr.legal ? '' : ' illegal'}` }, icon(v.icon, 14), clip(tr.to, 20), tr.legal ? null : h('span', { class: 'sr-only' }, ' (not allowed by the state machine)')),
      h('span', { class: 'seq' }, `#${tr.seq}`)));
  }
  host.appendChild(flow);
  if (task.transitions.length) {
    const rows = task.transitions.map((tr) => h('tr', null,
      h('td', { 'data-label': 'Entry' }, `#${tr.seq}`),
      h('td', { 'data-label': 'Time' }, formatT(tr.t, model)),
      h('td', { 'data-label': 'Transition', class: 'mono' }, `${clip(tr.from, 20)} → ${clip(tr.to, 20)}`),
      h('td', { 'data-label': 'Because' }, clip(tr.cause, 120)),
      h('td', { 'data-label': 'Allowed' }, tr.legal ? chip('ok', 'check', 'yes') : chip('bad', 'cross', 'NO'))));
    host.appendChild(h('table', { class: 'data compact' },
      h('caption', { class: 'sr-only' }, 'State transitions derived from the log entries'),
      h('thead', null, h('tr', null, ['Entry', 'Time', 'Transition', 'Because', 'Allowed'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows)));
  } else host.appendChild(h('p', { class: 'muted' }, 'This task has no events: it was never started.'));

  // Attempts.
  host.appendChild(h('h4', null, 'Attempts'));
  if (!task.attemptList.length) host.appendChild(h('p', { class: 'muted' }, task.finalStatus === 'blocked' || task.finalStatus === 'pending' ? 'Never started. In a run that ended, that means a task it depends on did not succeed (or the run was cancelled first).' : 'No attempts recorded.'));
  const list = h('ol', { class: 'attempts' });
  for (const att of task.attemptList) {
    const kv = kindView(att.kind);
    list.appendChild(h('li', { class: `attempt-card tone-${kv.tone}` },
      h('div', { class: 'attempt-head' }, h('strong', null, att.no === null ? 'Attempt ?' : `Attempt ${att.no}`), chip(kv.tone, kv.icon, kv.label), att.label && att.label !== kv.label ? h('span', { class: 'muted' }, clip(att.label, 120)) : null),
      h('ul', { class: 'ev-list' }, att.events.map((e) => h('li', null,
        h('button', { type: 'button', class: 'linklike mono', listeners: { click: () => onOpenEvent(e) } }, `#${e.seq}`),
        h('span', { class: 'ev-type' }, e.type),
        h('span', { class: 'muted' }, describeEvent(e)))))));
  }
  host.appendChild(list);
}

// ------------------------------------------------------------------ invariants

const INV_STATE = {
  ok: { tone: 'ok', icon: 'check', label: 'Holds' },
  violated: { tone: 'bad', icon: 'cross', label: 'Violated' },
  'needs-spec': { tone: 'mute', icon: 'dot', label: 'Needs spec' },
  'prefix-ok': { tone: 'warn', icon: 'question', label: 'No violation in verified prefix; rest unchecked' },
};

function renderInvariants(host, a, onOpenSeq, pickSpec, clearSpec, specName) {
  clear(host);
  const mode = a.spec ? `Checked with the run spec${specName ? ` (${clip(specName, 40)})` : ''}: all invariants.` : 'Checked from the log alone: I1, I4, I6, I7, I8 and attempt numbering. I2, I3 and I5 also need the run spec.';
  host.appendChild(h('div', { class: 'inv-head' },
    h('p', null, mode),
    a.spec
      ? h('button', { type: 'button', class: 'btn small', listeners: { click: clearSpec } }, 'Remove spec')
      : h('button', { type: 'button', class: 'btn small', listeners: { click: pickSpec } }, 'Load run spec JSON…')));
  if (a.chain.status === 'broken') host.appendChild(h('p', { class: 'note tone-bad' }, icon('unlink', 14), h('span', null, `The chain is broken, so the engine’s audit stops at I8. Everything else is evaluated on the verified prefix (entries 1–${a.chain.verified}) only.`)));
  const list = h('ul', { class: 'inv-list' });
  for (const row of a.invariants) {
    const v = INV_STATE[row.state];
    const li = h('li', { class: `inv tone-${v.tone}` },
      h('div', { class: 'inv-top' }, h('span', { class: 'inv-id' }, row.id), h('span', { class: 'inv-title' }, row.title), chip(v.tone, v.icon, v.label)),
      h('p', { class: 'muted' }, row.detail));
    if (row.violations.length) {
      li.appendChild(h('ul', { class: 'viol' }, row.violations.slice(0, 20).map((x) => h('li', null,
        x.seq ? h('button', { type: 'button', class: 'linklike mono', listeners: { click: () => onOpenSeq(x.seq) } }, `#${x.seq}`) : null,
        h('span', { class: 'mono' }, x.code), h('span', null, clip(x.message, 200))))));
    }
    list.appendChild(li);
  }
  host.appendChild(list);
}

// ------------------------------------------------------------------ events

function searchText(e) {
  if (e.search === undefined) {
    let data = '';
    try { data = JSON.stringify(e.dataObj).slice(0, 1500); } catch (_error) { data = ''; }
    e.search = `${e.seq} ${e.type} ${e.task || ''} ${e.attempt || ''} ${describeEvent(e)} ${data}`.toLowerCase();
  }
  return e.search;
}

function filterEvents(model, { query, type, task }) {
  const q = query.trim().toLowerCase();
  return model.global.events.filter((e) => (type === '' || e.type === type) && (task === '' || e.task === task) && (q === '' || searchText(e).includes(q)));
}

function renderEventFilters(host, a, filters, onChange) {
  clear(host);
  const typeCounts = new Map();
  for (const e of a.model.global.events) typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
  const typeSel = h('select', { id: 'f-type', listeners: { change: (ev) => onChange({ type: ev.target.value }) } },
    h('option', { value: '' }, `All types (${a.model.eventCount})`),
    [...EVENT_TYPES.filter((t) => typeCounts.has(t)), ...[...typeCounts.keys()].filter((t) => !EVENT_TYPES.includes(t))]
      .map((t) => h('option', { value: t, selected: filters.type === t }, `${clip(t, 30)} (${typeCounts.get(t)})`)));
  const tasks = a.model.taskOrder.slice(0, 300);
  const taskSel = h('select', { id: 'f-task', listeners: { change: (ev) => onChange({ task: ev.target.value }) } },
    h('option', { value: '' }, 'All tasks'),
    tasks.map((t) => h('option', { value: t, selected: filters.task === t }, clip(t, 40))));
  const search = h('input', { id: 'f-query', type: 'search', placeholder: 'e.g. WORKER_CRASH, enrich.2, digest', value: filters.query, autocomplete: 'off', spellcheck: 'false', listeners: { input: (ev) => onChange({ query: ev.target.value }) } });
  host.appendChild(h('div', { class: 'filter' }, h('label', { for: 'f-query' }, 'Search'), search));
  host.appendChild(h('div', { class: 'filter' }, h('label', { for: 'f-type' }, 'Event type'), typeSel));
  host.appendChild(h('div', { class: 'filter' }, h('label', { for: 'f-task' }, 'Task'), taskSel));
}

const PAGE = 150;

function renderEvents(host, countHost, a, filters, limit, onOpen, onMore) {
  clear(host);
  const rows = filterEvents(a.model, filters);
  const shown = rows.slice(0, limit);
  countHost.textContent = `${rows.length.toLocaleString('en-US')} of ${a.model.eventCount.toLocaleString('en-US')} entries match`;
  const body = h('tbody');
  for (const e of shown) {
    const trusted = e.index < a.chain.verified;
    const broken = a.chain.status === 'broken' && e.index === a.chain.verified;
    const mark = trusted ? null : chip(broken ? 'bad' : 'warn', broken ? 'unlink' : 'question', broken ? 'chain breaks here' : 'unverified');
    body.appendChild(h('tr', { class: trusted ? null : 'unverified', listeners: { click: () => onOpen(e) } },
      h('th', { scope: 'row', 'data-label': 'Entry' }, h('button', { type: 'button', class: 'linklike mono', 'aria-label': `Open entry ${e.seq}`, listeners: { click: (ev) => { ev.stopPropagation(); onOpen(e); } } }, `#${e.seq}`)),
      h('td', { 'data-label': 'Time' }, formatT(e.t, a.model)),
      h('td', { 'data-label': 'Event', class: 'mono' }, clip(e.type, 30)),
      h('td', { 'data-label': 'Task' }, e.task ? clip(e.task, 40) : '—'),
      h('td', { 'data-label': 'Attempt' }, e.attempt ? clip(e.attempt, 40) : '—'),
      h('td', { 'data-label': 'What happened' }, describeEvent(e), mark ? ' ' : null, mark)));
  }
  host.appendChild(h('table', { class: 'data events' },
    h('caption', { class: 'sr-only' }, 'Log entries in order. Activate a row to see the raw entry.'),
    h('thead', null, h('tr', null, ['Entry', 'Time', 'Event', 'Task', 'Attempt', 'What happened'].map((t) => h('th', { scope: 'col' }, t)))),
    body));
  if (!rows.length) host.appendChild(h('p', { class: 'muted pad' }, 'No entries match these filters.'));
  if (rows.length > shown.length) host.appendChild(h('button', { type: 'button', class: 'btn', listeners: { click: onMore } }, `Show ${Math.min(PAGE, rows.length - shown.length)} more (${rows.length - shown.length} hidden)`));
}

// ------------------------------------------------------------------ entry dialog

const RAW_LIMIT = 20000;

function renderEntry(host, a, e, nav) {
  clear(host);
  const raw = a.parsed.entries[e.index];
  const line = a.parsed.lineNumbers[e.index];
  const trusted = e.index < a.chain.verified;
  const broken = a.chain.status === 'broken' && e.index === a.chain.verified;

  host.appendChild(h('div', { class: 'dlg-head' },
    h('h3', { id: 'dlg-title' }, `Entry #${clip(String(e.seq), 12)} · ${clip(e.type, 30)}`),
    h('button', { type: 'button', class: 'btn small', 'data-close': 'true', listeners: { click: nav.close } }, 'Close')));
  const status = h('p', { class: 'dlg-status' });
  if (trusted) status.appendChild(chip('ok', 'check', 'Verified: hash and chain link are correct'));
  else if (broken) status.appendChild(chip('bad', 'unlink', 'This is the entry where the chain breaks'));
  else status.appendChild(chip('warn', 'question', 'Not verified: it comes after a chain break'));
  host.appendChild(status);
  host.appendChild(h('p', null, describeEvent(e) || '—'));

  const dl = h('dl', { class: 'facts' });
  const add = (k, v, mono) => dl.appendChild(h('div', null, h('dt', null, k), h('dd', { class: mono ? 'mono' : null }, v)));
  add('Line in file', String(line));
  add('Time', `${formatT(e.t, a.model)} (t = ${clip(String(e.t), 20)})`);
  if (e.task) add('Task', clip(e.task, 60));
  if (e.attempt) add('Attempt', clip(e.attempt, 60));
  if (raw && typeof raw === 'object') {
    add('Stored hash', clip(String(raw.hash), 80), true);
    add('Previous hash', raw.prev === null ? 'null (first entry)' : clip(String(raw.prev), 80), true);
  }
  const recomputed = h('dd', { class: 'mono' }, 'computing…');
  dl.appendChild(h('div', null, h('dt', null, 'Recomputed hash'), recomputed));
  host.appendChild(dl);
  computeEntryHash(raw).then((hash) => {
    if (!recomputed.isConnected) return;
    if (hash === null) recomputed.textContent = 'cannot be computed for this entry';
    else recomputed.textContent = raw && hash === raw.hash ? `${clip(hash, 80)}  (matches the stored hash)` : `${clip(hash, 80)}  (DIFFERS from the stored hash)`;
  });

  let pretty;
  try { pretty = JSON.stringify(raw, null, 2); } catch (_error) { pretty = String(raw); }
  host.appendChild(h('h4', null, 'Raw entry (as read from the file)'));
  host.appendChild(h('pre', { class: 'raw', tabindex: '0', 'aria-label': 'Raw JSON of the entry' }, clip(pretty, RAW_LIMIT, true)));
  host.appendChild(h('div', { class: 'dlg-actions' },
    h('button', { type: 'button', class: 'btn small', disabled: nav.prev ? null : true, listeners: { click: () => nav.prev && nav.prev() } }, 'Previous entry'),
    h('button', { type: 'button', class: 'btn small', disabled: nav.next ? null : true, listeners: { click: () => nav.next && nav.next() } }, 'Next entry'),
    h('button', { type: 'button', class: 'btn small', listeners: { click: () => nav.copy(pretty) } }, 'Copy JSON')));
}

module.exports = {
  PAGE, chip, renderBanner, renderEntry, renderEventFilters, renderEvents, renderInvariants, renderSummary, renderTaskDetail, renderTasks, shortHash,
};
