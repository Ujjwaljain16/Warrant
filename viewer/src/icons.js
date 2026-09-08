'use strict';

// Small stroke icons (16x16 grid, drawn with currentColor). Status is always shown as icon + word + colour,
// never colour alone. Icon paths are constants, not derived from the log.

const { s } = require('./dom');

const PATHS = {
  check: ['M3.5 8.5 L6.5 11.5 L12.5 4.5'],
  cross: ['M4 4 L12 12', 'M12 4 L4 12'],
  question: ['M6 6.3 A2 2 0 1 1 9 8 C8.3 8.5 8 9 8 9.8', 'M8 12.2 L8 12.3'],
  slash: ['M8 2.5 A5.5 5.5 0 1 0 8.01 2.5 Z', 'M4.2 4.2 L11.8 11.8'],
  stop: ['M4.5 4.5 H11.5 V11.5 H4.5 Z'],
  play: ['M5.5 4 L11.5 8 L5.5 12 Z'],
  dot: ['M8 6 A2 2 0 1 0 8.01 6 Z'],
  bolt: ['M9 2 L4 9 H8 L7 14 L12 7 H8 Z'],
  clock: ['M8 2.5 A5.5 5.5 0 1 0 8.01 2.5 Z', 'M8 5 V8 L10 9.5'],
  bang: ['M8 3.5 V9', 'M8 12 L8 12.1'],
  flag: ['M5 13.5 V2.5', 'M5 3 H11.5 L10 5.8 L11.5 8.5 H5'],
  retry: ['M12.5 8 A4.5 4.5 0 1 1 11.2 4.8', 'M12.5 2.8 V5.5 H9.8'],
  copy: ['M5.5 5.5 H12.5 V12.5 H5.5 Z', 'M3.5 10.5 V3.5 H10.5'],
  link: ['M6.5 9.5 L9.5 6.5', 'M7 4.5 L8 3.5 A2.1 2.1 0 0 1 11 6.5 L10 7.5', 'M9 11.5 L8 12.5 A2.1 2.1 0 0 1 5 9.5 L6 8.5'],
  unlink: ['M7 4.5 L8 3.5 A2.1 2.1 0 0 1 11 6.5 L10 7.5', 'M9 11.5 L8 12.5 A2.1 2.1 0 0 1 5 9.5 L6 8.5', 'M3 3 L13 13'],
  dots: ['M4 8 L4 8.1', 'M8 8 L8 8.1', 'M12 8 L12 8.1'],
  sun: ['M8 5.5 A2.5 2.5 0 1 0 8.01 5.5 Z', 'M8 1.5 V3', 'M8 13 V14.5', 'M1.5 8 H3', 'M13 8 H14.5', 'M3.4 3.4 L4.5 4.5', 'M11.5 11.5 L12.6 12.6', 'M3.4 12.6 L4.5 11.5', 'M11.5 4.5 L12.6 3.4'],
  moon: ['M12.5 9.5 A5 5 0 1 1 6.5 3.5 A4 4 0 0 0 12.5 9.5 Z'],
  auto: ['M8 2.5 A5.5 5.5 0 1 0 8.01 2.5 Z', 'M8 2.5 V13.5'],
  upload: ['M8 11 V3', 'M5 6 L8 3 L11 6', 'M3 13 H13'],
  doc: ['M4 2.5 H9.5 L12 5 V13.5 H4 Z', 'M9.5 2.5 V5 H12'],
};

// Status / outcome vocabulary shared by table, timeline and legend: icon, word, tone (colour class).
const STATUS_VIEW = {
  succeeded: { icon: 'check', label: 'succeeded', tone: 'ok' },
  failed: { icon: 'cross', label: 'failed', tone: 'bad' },
  blocked: { icon: 'slash', label: 'blocked', tone: 'mute' },
  unknown: { icon: 'question', label: 'unknown', tone: 'warn' },
  cancelled: { icon: 'stop', label: 'cancelled', tone: 'info' },
  running: { icon: 'play', label: 'unfinished', tone: 'info' },
  pending: { icon: 'dot', label: 'never started', tone: 'mute' },
  verifying: { icon: 'clock', label: 'verifying', tone: 'info' },
};

const KIND_VIEW = {
  accepted: { icon: 'check', label: 'accepted', tone: 'ok', pattern: 'solid' },
  rejected: { icon: 'cross', label: 'rejected by gate', tone: 'bad', pattern: 'hatch' },
  unverified: { icon: 'question', label: 'not verified', tone: 'warn', pattern: 'dash' },
  failed: { icon: 'cross', label: 'worker failed', tone: 'bad', pattern: 'solid' },
  crashed: { icon: 'bolt', label: 'crashed', tone: 'bad', pattern: 'dash' },
  timeout: { icon: 'clock', label: 'timed out', tone: 'warn', pattern: 'dash' },
  ambiguous: { icon: 'question', label: 'ambiguous', tone: 'violet', pattern: 'dot' },
  cancelled: { icon: 'stop', label: 'cancelled', tone: 'info', pattern: 'solid' },
  open: { icon: 'dots', label: 'no outcome', tone: 'mute', pattern: 'dash' },
};

function statusView(status) {
  return Object.hasOwn(STATUS_VIEW, status) ? STATUS_VIEW[status] : { icon: 'question', label: 'unrecognised status', tone: 'warn' };
}

function kindView(kind) {
  return Object.hasOwn(KIND_VIEW, kind) ? KIND_VIEW[kind] : KIND_VIEW.open;
}

// An inline <svg> icon element. `size` is the rendered px size.
function icon(name, size = 14, attrs = {}) {
  const paths = Object.hasOwn(PATHS, name) ? PATHS[name] : PATHS.question;
  return s('svg', { viewBox: '0 0 16 16', width: size, height: size, class: 'icon', 'aria-hidden': 'true', focusable: 'false', ...attrs },
    paths.map((d) => s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
}

// The same path data for use inside a larger SVG, scaled and moved to (x, y) as a group.
function iconGroup(name, x, y, size) {
  const paths = Object.hasOwn(PATHS, name) ? PATHS[name] : PATHS.question;
  const k = size / 16;
  return s('g', { transform: `translate(${x} ${y}) scale(${k})`, 'aria-hidden': 'true' },
    paths.map((d) => s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
}

module.exports = { KIND_VIEW, STATUS_VIEW, icon, iconGroup, kindView, statusView };
