'use strict';

const CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const IDENT = /^[0-9A-Za-z-]+$/;
const NUMERIC = /^(0|[1-9]\d*)$/;

function parse(version) {
  if (typeof version !== 'string') {
    throw new TypeError('version must be a string');
  }
  let rest = version;
  let build = null;
  let pre = null;

  const plus = rest.indexOf('+');
  if (plus !== -1) {
    build = rest.slice(plus + 1);
    rest = rest.slice(0, plus);
    if (!build.split('.').every((id) => IDENT.test(id))) {
      throw new SyntaxError(`Invalid semver build metadata: ${version}`);
    }
  }

  const dash = rest.indexOf('-');
  if (dash !== -1) {
    pre = rest.slice(dash + 1).split('.');
    rest = rest.slice(0, dash);
    for (const id of pre) {
      if (!IDENT.test(id)) {
        throw new SyntaxError(`Invalid semver pre-release: ${version}`);
      }
      if (/^[0-9]+$/.test(id) && !NUMERIC.test(id)) {
        throw new SyntaxError(`Invalid semver pre-release (leading zero): ${version}`);
      }
    }
  }

  const m = CORE.exec(rest);
  if (!m) {
    throw new SyntaxError(`Invalid semver version: ${version}`);
  }
  return { core: [m[1], m[2], m[3]], pre };
}

// Exact comparison of non-negative integers given as strings without leading zeros.
function compareNumeric(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePre(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const xNum = NUMERIC.test(x) && /^[0-9]+$/.test(x);
    const yNum = NUMERIC.test(y) && /^[0-9]+$/.test(y);
    let c;
    if (xNum && yNum) {
      c = compareNumeric(x, y);
    } else if (xNum) {
      c = -1;
    } else if (yNum) {
      c = 1;
    } else {
      c = x < y ? -1 : x > y ? 1 : 0;
    }
    if (c !== 0) return c;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function compareSemver(a, b) {
  const va = parse(a);
  const vb = parse(b);

  for (let i = 0; i < 3; i++) {
    const c = compareNumeric(va.core[i], vb.core[i]);
    if (c !== 0) return c;
  }

  if (va.pre === null && vb.pre === null) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return comparePre(va.pre, vb.pre);
}

module.exports = { compareSemver };
