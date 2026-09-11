'use strict';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parse(value) {
  const m = typeof value === 'string' ? VERSION.exec(value) : null;
  if (!m) throw new TypeError(`not a version: ${String(value)}`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? null : m[4].split('.') };
}

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
const isNumeric = (id) => /^\d+$/.test(id);

function comparePre(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const an = isNumeric(a[i]);
    const bn = isNumeric(b[i]);
    if (an && bn) return sign(Number(a[i]) - Number(b[i]));
    if (an) return -1;
    if (bn) return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return sign(a.length - b.length);
}

// Compares two version strings: -1 if a is older than b, 1 if newer, 0 if equal.
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return sign(x.core[i] - y.core[i]);
  return comparePre(x.pre, y.pre);
}

module.exports = { compare };
