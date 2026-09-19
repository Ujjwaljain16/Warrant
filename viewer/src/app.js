'use strict';

// Page controller: file loading, state, and wiring the panels together. Browser-only (needs a DOM).

const { analyze } = require('./analysis');
const { LIMITS, classifyText } = require('./parse');
const { clear, h } = require('./dom');
const { icon } = require('./icons');
const { clip } = require('./text');
const { renderLegend, renderTimeline, MAX_LANES } = require('./timeline');
const views = require('./views');
const SAMPLES = require('./samples');

const $ = (id) => document.getElementById(id);

const state = {
  analysis: null, source: '', logText: null, specValue: null, specName: null,
  selected: null, mode: 'seq', zoom: 1, filters: { query: '', type: '', task: '' }, limit: views.PAGE,
  theme: 'auto', token: 0, eventBySeq: new Map(), openIndex: null,
};

function setStatus(text, tone = 'info') {
  const el = $('status');
  clear(el);
  if (!text) { el.setAttribute('class', 'status'); return; }
  el.setAttribute('class', `status tone-${tone}`);
  el.appendChild(icon(tone === 'bad' ? 'cross' : tone === 'ok' ? 'check' : 'bang', 14));
  el.appendChild(h('span', null, text));
}

function fmtBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} bytes`;
}

// ------------------------------------------------------------------ loading

function interestingTask(a) {
  const order = a.model.taskOrder;
  const rank = (id) => {
    const t = a.model.tasks.get(id);
    if (['failed', 'unknown'].includes(t.finalStatus)) return 0;
    if (t.attemptList.some((x) => ['rejected', 'ambiguous', 'crashed', 'timeout'].includes(x.kind))) return 1;
    return 2;
  };
  return order.length ? [...order].sort((x, y) => rank(x) - rank(y))[0] : null;
}

async function load(text, { source, specValue = null, specName = null, keepSelection = false }) {
  const token = ++state.token;
  setStatus('Verifying the hash chain…');
  let a;
  try {
    a = await analyze(text, { specValue, name: source });
  } catch (error) {
    if (token === state.token) setStatus(`Could not analyse this file: ${clip(error && error.message ? error.message : String(error), 200)}`, 'bad');
    return;
  }
  if (token !== state.token) return;
  state.analysis = a;
  state.logText = text;
  state.source = source;
  state.specValue = specValue;
  state.specName = specName;
  state.eventBySeq = new Map();
  for (const e of a.model.global.events) if (!state.eventBySeq.has(e.seq)) state.eventBySeq.set(e.seq, e);
  if (!keepSelection || !a.model.tasks.has(state.selected)) state.selected = interestingTask(a);
  state.filters = { query: '', type: '', task: '' };
  state.limit = views.PAGE;
  setStatus('');
  renderAll();
}

function loadSample(id) {
  const sample = SAMPLES.find((x) => x.id === id);
  if (!sample) return Promise.resolve();
  let specValue = null;
  try { specValue = JSON.parse(sample.spec); } catch (_error) { specValue = null; }
  markSamples(id);
  return load(sample.log, { source: `${sample.title} (built-in sample)`, specValue, specName: 'nightly-etl.spec.json' });
}

function markSamples(activeId) {
  const active = SAMPLES.find((x) => x.id === activeId);
  $('sample-blurb').textContent = active ? active.blurb : '';
  for (const b of document.querySelectorAll('#sample-list button')) b.setAttribute('aria-pressed', b.dataset.id === activeId ? 'true' : 'false');
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let log = null;
  let spec = null;
  const notes = [];
  for (const f of files) {
    if (f.size > LIMITS.maxBytes) { notes.push(`${clip(f.name, 60)} is ${fmtBytes(f.size)}; files over ${fmtBytes(LIMITS.maxBytes)} are not opened.`); continue; }
    let text;
    try { text = await f.text(); } catch (_error) { notes.push(`${clip(f.name, 60)} could not be read.`); continue; }
    const cls = classifyText(text);
    if (cls.kind === 'spec') { if (!spec) spec = { value: cls.value, name: f.name }; else notes.push(`Extra spec ${clip(f.name, 60)} ignored.`); }
    else if (cls.kind === 'log') { if (!log) log = { text, name: f.name, size: f.size }; else notes.push(`Extra log ${clip(f.name, 60)} ignored; open one log at a time.`); }
    else if (cls.kind === 'empty') notes.push(`${clip(f.name, 60)} is empty.`);
    else notes.push(`${clip(f.name, 60)} is neither a run log (JSONL) nor a run spec.`);
  }
  if (log) {
    markSamples(null);
    await load(log.text, { source: `${clip(log.name, 80)} (${fmtBytes(log.size)})`, specValue: spec ? spec.value : null, specName: spec ? spec.name : null });
  } else if (spec) {
    if (state.logText !== null) await load(state.logText, { source: state.source, specValue: spec.value, specName: spec.name, keepSelection: true });
    else notes.push('Spec noted, but no log is open yet.');
  }
  if (notes.length) setStatus(notes.join(' '), log || spec ? 'info' : 'bad');
}

// ------------------------------------------------------------------ rendering

function renderAll() {
  const a = state.analysis;
  $('welcome').hidden = true;
  $('content').hidden = false;
  views.renderBanner($('banner'), a, state.source);
  views.renderSummary($('summary'), a);
  renderTimelinePanel();
  views.renderTasks($('tasks'), a, state.selected, selectTask);
  renderDetail();
  views.renderInvariants($('invariants'), a, openSeq, () => $('file-spec').click(), clearSpec, state.specName);
  views.renderEventFilters($('filters'), a, state.filters, (patch) => { Object.assign(state.filters, patch); state.limit = views.PAGE; renderEventsPanel(); });
  renderEventsPanel();
  document.title = state.source ? `${clip(state.source, 60)} — Warrant run viewer` : 'Warrant run viewer';
}

function renderTimelinePanel() {
  const a = state.analysis;
  if (!a) return;
  const host = $('timeline');
  const mode = state.mode === 'time' && !a.model.tMeaningful ? 'seq' : state.mode;
  const info = renderTimeline(host, {
    model: a.model, chain: a.chain, mode, zoom: state.zoom, selected: state.selected,
    narrow: host.clientWidth < 560, onSelectTask: selectTask, onOpenEvent: (e) => { if (e) openEvent(e); },
  });
  $('mode-time').disabled = !a.model.tMeaningful;
  $('mode-seq').setAttribute('aria-pressed', String(mode === 'seq'));
  $('mode-time').setAttribute('aria-pressed', String(mode === 'time'));
  $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  const notes = [];
  if (!a.model.tMeaningful) notes.push('The timestamps in this log do not vary, so the axis is the log sequence.');
  if (info.truncatedLanes) notes.push(`Showing the first ${MAX_LANES} of ${a.model.taskOrder.length} tasks; the tables below list all.`);
  if (info.markersHidden) notes.push('This log is large, so only attempt bars and final states are drawn; the event table has everything.');
  $('timeline-note').textContent = notes.join(' ');
}

function renderDetail() {
  views.renderTaskDetail($('detail'), state.analysis, state.selected, openEvent, (id) => {
    state.filters = { query: '', type: '', task: id };
    state.limit = views.PAGE;
    views.renderEventFilters($('filters'), state.analysis, state.filters, (patch) => { Object.assign(state.filters, patch); state.limit = views.PAGE; renderEventsPanel(); });
    renderEventsPanel();
    $('sec-events').scrollIntoView({ block: 'start' });
  });
}

function renderEventsPanel() {
  views.renderEvents($('events'), $('events-count'), state.analysis, state.filters, state.limit, openEvent, () => { state.limit += views.PAGE; renderEventsPanel(); });
}

function selectTask(id) {
  if (state.selected === id) return;
  state.selected = id;
  const a = state.analysis;
  renderTimelinePanel();
  views.renderTasks($('tasks'), a, state.selected, selectTask);
  renderDetail();
}

function clearSpec() {
  if (state.logText !== null) load(state.logText, { source: state.source, specValue: null, specName: null, keepSelection: true });
}

// ------------------------------------------------------------------ entry dialog

function openSeq(seq) {
  const e = state.eventBySeq.get(seq);
  if (e) openEvent(e);
}

function openEvent(e) {
  const a = state.analysis;
  if (!a || !e) return;
  const events = a.model.global.events;
  const pos = events.indexOf(e);
  const dlg = $('dlg');
  views.renderEntry(dlg, a, e, {
    close: () => dlg.close(),
    prev: pos > 0 ? () => openEvent(events[pos - 1]) : null,
    next: pos >= 0 && pos < events.length - 1 ? () => openEvent(events[pos + 1]) : null,
    copy: (text) => {
      const failed = () => setStatus('Copy is not available in this browser context.', 'bad');
      try { navigator.clipboard.writeText(text).then(() => setStatus('Entry JSON copied.', 'ok'), failed); } catch (_error) { failed(); }
    },
  });
  if (!dlg.open) {
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
}

// ------------------------------------------------------------------ theme, drop, boot

function setTheme(theme) {
  state.theme = theme;
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  const btn = $('btn-theme');
  clear(btn);
  btn.appendChild(icon(theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto', 16));
  btn.appendChild(h('span', null, theme === 'auto' ? 'Theme: auto' : theme === 'dark' ? 'Theme: dark' : 'Theme: light'));
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { sample: params.get('sample'), mode: params.get('mode'), task: params.get('task'), event: params.get('event'), theme: params.get('theme'), zoom: params.get('zoom') };
}

async function applyHash() {
  const p = readHash();
  if (p.theme === 'dark' || p.theme === 'light' || p.theme === 'auto') setTheme(p.theme);
  if (p.mode === 'time' || p.mode === 'seq') state.mode = p.mode;
  if (p.zoom && Number.isFinite(Number(p.zoom))) state.zoom = Math.min(8, Math.max(0.5, Number(p.zoom)));
  if (p.sample && SAMPLES.some((x) => x.id === p.sample)) {
    await loadSample(p.sample);
    if (p.task && state.analysis.model.tasks.has(p.task)) selectTask(p.task);
    renderTimelinePanel();
    if (p.event) openSeq(Number(p.event));
  }
}

function boot() {
  setTheme('auto');
  const list = $('sample-list');
  for (const sample of SAMPLES) {
    list.appendChild(h('button', { type: 'button', class: 'btn', 'data-id': sample.id, 'aria-pressed': 'false', listeners: { click: () => { loadSample(sample.id); } } }, sample.title));
  }
  $('btn-open').addEventListener('click', () => $('file-log').click());
  $('btn-spec').addEventListener('click', () => $('file-spec').click());
  $('btn-theme').addEventListener('click', () => setTheme(state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'));
  $('file-log').addEventListener('change', (ev) => { handleFiles(ev.target.files); ev.target.value = ''; });
  $('file-spec').addEventListener('change', (ev) => { handleFiles(ev.target.files); ev.target.value = ''; });
  $('mode-seq').addEventListener('click', () => { state.mode = 'seq'; renderTimelinePanel(); });
  $('mode-time').addEventListener('click', () => { state.mode = 'time'; renderTimelinePanel(); });
  $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(8, state.zoom * 1.5); renderTimelinePanel(); });
  $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.5, state.zoom / 1.5); renderTimelinePanel(); });
  renderLegend($('legend'));

  const dlg = $('dlg');
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });

  let depth = 0;
  const drop = $('drop');
  window.addEventListener('dragenter', (ev) => { ev.preventDefault(); depth++; drop.hidden = false; });
  window.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
  window.addEventListener('drop', (ev) => {
    ev.preventDefault();
    depth = 0;
    drop.hidden = true;
    if (ev.dataTransfer && ev.dataTransfer.files) handleFiles(ev.dataTransfer.files);
  });

  let lastWidth = 0;
  const watch = () => {
    const w = $('timeline').clientWidth;
    if (state.analysis && Math.abs(w - lastWidth) > 8) { lastWidth = w; renderTimelinePanel(); }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(watch).observe($('timeline'));
  else window.addEventListener('resize', watch);
  window.addEventListener('hashchange', applyHash);

  if (readHash().sample) applyHash(); else loadSample(SAMPLES.some((x) => x.id === 'lying-worker') ? 'lying-worker' : SAMPLES[0].id);
}

boot();
