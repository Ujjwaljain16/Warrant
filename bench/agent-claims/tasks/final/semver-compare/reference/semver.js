'use strict';

const ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
const VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${ID}(?:\\.${ID})*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`);

function parse(value) {
  if (typeof value !== 'string') throw new TypeError('versions must be strings');
  const m = VERSION.exec(value);
  if (!m) throw new SyntaxError(`not a semantic version: ${value}`);
  return { core: [m[1], m[2], m[3]].map((x) => BigInt(x)), pre: m[4] === undefined ? null : m[4].split('.') };
}

const sign = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isNumeric = (s) => /^\d+$/.test(s);

function compareIdentifier(x, y) {
  const xn = isNumeric(x);
  const yn = isNumeric(y);
  if (xn && yn) return sign(BigInt(x), BigInt(y));
  if (xn) return -1;
  if (yn) return 1;
  return sign(x, y);
}

function compareSemver(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const c = sign(pa.core[i], pb.core[i]);
    if (c !== 0) return c;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const n = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const c = compareIdentifier(pa.pre[i], pb.pre[i]);
    if (c !== 0) return c;
  }
  return sign(pa.pre.length, pb.pre.length);
}

module.exports = { compareSemver };
