'use strict';

// Per-task swimlane timeline (SVG). x is the log sequence, or the writer's clock when it is meaningful.
// Every attempt and event is drawn with a distinct shape, an icon and a text label as well as a colour, is
// focusable, and opens the raw entry on Enter/click. All text comes through textContent via dom.s().

const { s } = require('./dom');
const { iconGroup, kindView, statusView } = require('./icons');
const { clip } = require('./text');
const { describeEvent, formatT } = require('./describe');

const MAX_LANES = 200;
const MAX_MARKERS = 4000;
const LANE_H = 60;
const TOP = 38;
const PAD_R = 28;

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function toneClass(tone) { return `tone-${tone}`; }

function renderTimeline(host, { model, chain, mode, zoom, selected, narrow, onSelectTask, onOpenEvent }) {
  while (host.firstChild) host.removeChild(host.firstChild);
  const labelW = narrow ? 92 : 140;
  const avail = Math.max(host.clientWidth || 0, 320);
  const span0 = Math.max((mode === 'time' && model.tMeaningful ? 0 : model.seqMax) - 1, 1);
  const plotW = Math.min(Math.max(avail - labelW - PAD_R, span0 * 26, narrow ? 260 : 420), 3000) * zoom;
  const width = labelW + plotW + PAD_R;
  const useTime = mode === 'time' && model.tMeaningful;
  const inset = 14;
  const lo = useTime ? model.tMin : 1;
  const hi = useTime ? model.tMax : Math.max(model.seqMax, 2);
  const span = Math.max(hi - lo, 1);
  const xOf = (seq, t) => labelW + inset + (((useTime ? t : seq) - lo) / span) * (plotW - 2 * inset);

  const ids = model.taskOrder.slice(0, MAX_LANES);
  const height = TOP + ids.length * LANE_H + 12;
  const drawMarkers = model.eventCount <= MAX_MARKERS;

  const svg = s('svg', {
    class: 'timeline', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group',
    'aria-label': 'Swimlane timeline: one row per task, one bar per attempt, markers for gate verdicts, reconciles, duplicates and settlement',
  });
  svg.appendChild(s('defs', null,
    s('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 6, height: 6, class: 'hatch-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' })),
    s('pattern', { id: 'dots', width: 5, height: 5, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 5, height: 5, class: 'dots-bg' }), s('circle', { cx: 2.5, cy: 2.5, r: 1, class: 'dots-dot' }))));

  // Axis.
  const step = niceStep(span, Math.floor(plotW / 90));
  const axis = s('g', { class: 'axis', 'aria-hidden': 'true' });
  axis.appendChild(s('text', { x: 6, y: 22, class: 'axis-title' }, useTime ? 'time since first entry' : 'log sequence (entry #)'));
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const x = xOf(v, v);
    axis.appendChild(s('line', { x1: x, y1: TOP - 6, x2: x, y2: height - 8, class: 'grid' }));
    axis.appendChild(s('text', { x, y: TOP - 12, class: 'tick', 'text-anchor': 'middle' }, useTime ? formatT(v, model) : String(Math.round(v))));
  }
  svg.appendChild(axis);

  // Unverified region and chain break.
  if (chain.status === 'broken' && chain.broken && chain.broken.index <= model.seqMax) {
    const bx = xOf(chain.broken.index, useTime ? (model.global.events[chain.broken.index - 1] || { t: lo }).t : 0) - 6;
    svg.appendChild(s('rect', { x: bx, y: TOP - 6, width: Math.max(0, width - bx - 4), height: height - TOP - 2, class: 'unverified-zone' },
      s('title', null, `Entries from #${chain.broken.index} onward are not verified`)));
    svg.appendChild(s('line', { x1: bx, y1: TOP - 6, x2: bx, y2: height - 6, class: 'break-line' }));
    svg.appendChild(s('g', { class: 'tone-bad break-flag', transform: `translate(${bx + 4} ${height - 22})` },
      iconGroup('unlink', 0, 0, 14), s('text', { x: 18, y: 11, class: 'flag-label' }, `chain breaks at entry ${chain.broken.index}`)));
  }

  // Cancel line.
  const cancel = model.global.cancel;
  if (cancel) {
    const cx = xOf(cancel.seq, cancel.t);
    svg.appendChild(s('line', { x1: cx, y1: TOP - 6, x2: cx, y2: height - 8, class: 'cancel-line' }));
    svg.appendChild(s('g', { class: 'tone-info cancel-flag', transform: `translate(${cx + 3} ${TOP - 4})` },
      iconGroup('flag', 0, 0, 13), s('text', { x: 15, y: 10, class: 'flag-label' }, 'cancel requested')));
  }

  ids.forEach((id, row) => {
    const task = model.tasks.get(id);
    const y0 = TOP + row * LANE_H;
    const cy = y0 + 20;
    const mcy = y0 + 45;
    const mid = y0 + LANE_H / 2;
    const view = statusView(task.finalStatus);
    const lane = s('g', { class: `lane${selected === id ? ' selected' : ''}` });
    lane.appendChild(s('rect', { x: 0, y: y0, width, height: LANE_H, class: 'lane-bg' }));

    const label = s('g', {
      class: `lane-label ${toneClass(view.tone)}`, role: 'button', tabindex: '0',
      'aria-label': `Task ${clip(id, 40)}, ${view.label}. Select to show its detail.`,
      listeners: {
        click: () => onSelectTask(id),
        keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelectTask(id); } },
      },
    });
    label.appendChild(s('rect', { x: 0, y: y0 + 1, width: labelW - 4, height: LANE_H - 2, class: 'label-hit' }));
    label.appendChild(iconGroup(view.icon, 8, mid - 7, 14));
    label.appendChild(s('text', { x: 28, y: mid + 4, class: 'lane-name' }, clip(id, narrow ? 9 : 16)));
    label.appendChild(s('title', null, `${clip(id, 80)} — ${view.label}`));
    lane.appendChild(label);

    // Attempt bars.
    const links = s('g', { class: 'links', 'aria-hidden': 'true' });
    lane.appendChild(links);
    const bars = [];
    for (const att of task.attemptList) {
      const kv = kindView(att.kind);
      const x1 = xOf(att.startSeq, att.startT);
      const x2 = xOf(att.endSeq, att.endT);
      const w = Math.max(x2 - x1, 22);
      const text = `Attempt ${att.no === null ? '?' : att.no}: ${kv.label}${att.label && att.label !== kv.label ? ` (${clip(att.label, 80)})` : ''}`;
      const g = s('g', {
        class: `attempt k-${att.kind} ${toneClass(kv.tone)} p-${kv.pattern}`, role: 'button', tabindex: '0',
        'aria-label': `${clip(id, 40)} ${text}, entries ${att.startSeq} to ${att.endSeq}`,
        listeners: {
          click: () => { onSelectTask(id); onOpenEvent(att.events[0] || null); },
          keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelectTask(id); onOpenEvent(att.events[0] || null); } },
        },
      });
      g.appendChild(s('rect', { x: x1, y: cy - 10, width: w, height: 20, rx: 5, class: 'bar' }));
      g.appendChild(iconGroup(kv.icon, x1 + 4, cy - 6, 12));
      if (w >= 44 && att.no !== null) g.appendChild(s('text', { x: x1 + 19, y: cy + 4, class: 'bar-no' }, `#${att.no}`));
      g.appendChild(s('title', null, `${text}\nentries ${att.startSeq}–${att.endSeq}, ${formatT(att.startT, model)} → ${formatT(att.endT, model)}`));
      bars.push({ g, x1, x2: x1 + w, att });
      lane.appendChild(g);
    }
    // Retry connectors: an attempt followed by another attempt of the same task.
    for (let i = 0; i < bars.length - 1; i++) {
      const a = bars[i];
      const b = bars[i + 1];
      if (b.x1 > a.x2 + 4) links.appendChild(s('line', { x1: a.x2, y1: cy, x2: b.x1, y2: cy, class: 'retry-link' }));
    }

    // Event markers.
    if (drawMarkers) {
      const markers = [];
      for (const e of task.events) {
        const m = markerFor(e);
        if (m) markers.push({ e, m, x: xOf(e.seq, e.t) });
      }
      markers.sort((a, b) => a.x - b.x || a.e.seq - b.e.seq);
      let prevX = -Infinity;
      for (const mk of markers) {
        if (mk.x < prevX + 13) mk.x = prevX + 13;
        prevX = mk.x;
        lane.appendChild(drawMarker(mk, mcy, id, model, onOpenEvent, onSelectTask));
      }
    } else {
      for (const e of task.events) {
        if (e.type !== 'task_settled') continue;
        const mk = { e, m: markerFor(e), x: xOf(e.seq, e.t) };
        if (mk.m) lane.appendChild(drawMarker(mk, mcy, id, model, onOpenEvent, onSelectTask));
      }
    }
    svg.appendChild(lane);
  });

  host.appendChild(svg);
  return { truncatedLanes: model.taskOrder.length > MAX_LANES, markersHidden: !drawMarkers, lanes: ids.length };
}

function markerFor(e) {
  const d = e.dataObj || {};
  switch (e.type) {
    case 'gate_verdict': {
      const st = d.status;
      if (st === 'pass') return { shape: 'diamond', icon: 'check', tone: 'ok', label: 'gate passed' };
      if (st === 'fail') return { shape: 'diamond', icon: 'cross', tone: 'bad', label: 'gate rejected' };
      return { shape: 'diamond', icon: 'question', tone: 'warn', label: 'gate: not verified' };
    }
    case 'attempt_result':
      if (d.claim === 'success') return { shape: 'ring', icon: null, tone: 'mute', label: 'worker claimed success' };
      return null;
    case 'reconcile': return { shape: 'circle', icon: 'question', letter: 'R', tone: 'violet', label: `reconcile: ${clip(String(d.outcome), 30)}` };
    case 'attempt_ambiguous': return { shape: 'triangle', icon: 'bang', tone: 'violet', label: 'effect ambiguous' };
    case 'attempt_failed': return d.retry === true
      ? { shape: 'circle', icon: 'retry', tone: 'warn', label: 'attempt failed, will retry' }
      : { shape: 'circle', icon: 'cross', tone: 'bad', label: 'attempt failed, no retry' };
    case 'duplicate_ignored': return { shape: 'square', icon: 'copy', tone: 'mute', label: 'duplicate delivery ignored' };
    case 'task_settled': {
      const v = statusView(String(d.status));
      return { shape: 'cap', icon: v.icon, tone: v.tone, label: `settled: ${v.label}` };
    }
    default: return null;
  }
}

function drawMarker(mk, cy, taskId, model, onOpenEvent, onSelectTask) {
  const { e, m, x } = mk;
  const desc = `${m.label} — entry ${e.seq}, ${describeEvent(e)}`;
  const open = () => { onSelectTask(taskId); onOpenEvent(e); };
  const g = s('g', {
    class: `marker m-${m.shape} ${toneClass(m.tone)}`, role: 'button', tabindex: '0',
    'aria-label': clip(`${clip(taskId, 30)}: ${desc}`, 220),
    listeners: { click: open, keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } } },
  });
  const r = m.shape === 'cap' ? 11 : 9;
  const y = cy;
  switch (m.shape) {
    case 'diamond': g.appendChild(s('path', { d: `M${x} ${y - r - 1} L${x + r + 1} ${y} L${x} ${y + r + 1} L${x - r - 1} ${y} Z`, class: 'shape' })); break;
    case 'triangle': g.appendChild(s('path', { d: `M${x} ${y - r} L${x + r} ${y + r - 1} L${x - r} ${y + r - 1} Z`, class: 'shape' })); break;
    case 'square': g.appendChild(s('rect', { x: x - r + 1, y: y - r + 1, width: 2 * r - 2, height: 2 * r - 2, rx: 2, class: 'shape' })); break;
    case 'cap': g.appendChild(s('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 7, class: 'shape' })); break;
    case 'ring': g.appendChild(s('circle', { cx: x, cy: y, r: 4, class: 'shape ring' })); break;
    default: g.appendChild(s('circle', { cx: x, cy: y, r, class: 'shape' }));
  }
  if (m.shape === 'ring') {
    g.appendChild(s('title', null, desc));
    return g;
  }
  if (m.letter) g.appendChild(s('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'marker-letter' }, m.letter));
  else if (m.icon) g.appendChild(iconGroup(m.icon, x - 6, y - 6, 12));
  g.appendChild(s('title', null, desc));
  return g;
}

// Static key to the shapes and bars; each entry is icon + words, so it can be read without colour.
function renderLegend(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
  const item = (svgEl, text) => {
    const li = document.createElement('li');
    li.appendChild(svgEl);
    li.appendChild(document.createTextNode(text));
    return li;
  };
  const barSvg = (kind) => {
    const kv = kindView(kind);
    const svg = s('svg', { width: 34, height: 22, viewBox: '0 0 34 22', 'aria-hidden': 'true', focusable: 'false', class: 'legend-svg' });
    const g = s('g', { class: `attempt k-${kind} ${toneClass(kv.tone)} p-${kv.pattern}` });
    g.appendChild(s('rect', { x: 1, y: 2, width: 32, height: 18, rx: 5, class: 'bar' }));
    g.appendChild(iconGroup(kv.icon, 5, 5, 12));
    svg.appendChild(g);
    return svg;
  };
  const markerSvg = (m) => {
    const svg = s('svg', { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: 'legend-svg' });
    const g = drawMarker({ e: { seq: 0, type: '', dataObj: {} }, m, x: 12 }, 12, '', null, () => {}, () => {});
    g.removeAttribute('tabindex');
    g.removeAttribute('role');
    g.removeAttribute('aria-label');
    g.setAttribute('aria-hidden', 'true');
    svg.appendChild(g);
    return svg;
  };
  const bars = document.createElement('ul');
  bars.className = 'legend-list';
  for (const kind of ['accepted', 'rejected', 'unverified', 'failed', 'crashed', 'timeout', 'ambiguous', 'cancelled', 'open']) bars.appendChild(item(barSvg(kind), kindView(kind).label));
  const marks = document.createElement('ul');
  marks.className = 'legend-list';
  for (const [m, text] of [
    [markerFor({ type: 'attempt_result', dataObj: { claim: 'success' } }), 'worker claims success'],
    [markerFor({ type: 'gate_verdict', dataObj: { status: 'pass' } }), 'gate passed'],
    [markerFor({ type: 'gate_verdict', dataObj: { status: 'fail' } }), 'gate rejected the claim'],
    [markerFor({ type: 'gate_verdict', dataObj: { status: 'indeterminate' } }), 'gate could not verify'],
    [markerFor({ type: 'attempt_failed', dataObj: { retry: true } }), 'failed, will retry'],
    [markerFor({ type: 'attempt_ambiguous', dataObj: {} }), 'outcome ambiguous'],
    [markerFor({ type: 'reconcile', dataObj: { outcome: 'x' } }), 'reconcile'],
    [markerFor({ type: 'duplicate_ignored', dataObj: {} }), 'duplicate ignored'],
    [markerFor({ type: 'task_settled', dataObj: { status: 'succeeded' } }), 'task settled (final state)'],
  ]) marks.appendChild(item(markerSvg(m), text));
  host.appendChild(bars);
  host.appendChild(marks);
}

module.exports = { MAX_LANES, renderLegend, renderTimeline };
