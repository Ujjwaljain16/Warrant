'use strict';

function compareSemver(a, b) {
  if (typeof a !== 'string') {
    throw new TypeError('First argument must be a string');
  }
  if (typeof b !== 'string') {
    throw new TypeError('Second argument must be a string');
  }

  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  const majorCmp = compareBigInt(versionA.major, versionB.major);
  if (majorCmp !== 0) return majorCmp;

  const minorCmp = compareBigInt(versionA.minor, versionB.minor);
  if (minorCmp !== 0) return minorCmp;

  const patchCmp = compareBigInt(versionA.patch, versionB.patch);
  if (patchCmp !== 0) return patchCmp;

  if (versionA.prerelease === null && versionB.prerelease === null) {
    return 0;
  }
  if (versionA.prerelease === null) return 1;
  if (versionB.prerelease === null) return -1;

  return comparePrerelease(versionA.prerelease, versionB.prerelease);
}

function parseVersion(versionStr) {
  const match = versionStr.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/);

  if (!match) {
    throw new SyntaxError(`Invalid version string: "${versionStr}"`);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  const prerelease = match[4] ? match[4].split('.') : null;

  return {
    major,
    minor,
    patch,
    prerelease
  };
}

function compareBigInt(a, b) {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePrerelease(preA, preB) {
  const maxLen = Math.max(preA.length, preB.length);

  for (let i = 0; i < maxLen; i++) {
    if (i >= preA.length) return -1;
    if (i >= preB.length) return 1;

    const idA = preA[i];
    const idB = preB[i];

    const isNumA = /^\d+$/.test(idA);
    const isNumB = /^\d+$/.test(idB);

    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    if (isNumA && isNumB) {
      const cmp = compareBigInt(idA, idB);
      if (cmp !== 0) return cmp;
      continue;
    }

    if (idA < idB) return -1;
    if (idA > idB) return 1;
  }

  return 0;
}

module.exports = { compareSemver };
