'use strict';

function compareBigIntStrings(a, b) {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function parseSemver(v) {
  if (typeof v !== 'string') {
    throw new TypeError('Version must be a string');
  }

  const regex = /^([0]|[1-9][0-9]*)\.([0]|[1-9][0-9]*)\.([0]|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  const match = v.match(regex);
  if (!match) {
    throw new SyntaxError('Invalid semver version: ' + v);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  const prerelease = match[4] ? match[4].split('.') : null;
  const build = match[5] ? match[5].split('.') : null;

  if (prerelease) {
    for (const id of prerelease) {
      if (id === '') {
        throw new SyntaxError('Invalid prerelease identifier');
      }
      if (/^[0-9]+$/.test(id)) {
        if (id.length > 1 && id[0] === '0') {
          throw new SyntaxError('Numeric prerelease identifier cannot have leading zeros');
        }
      }
    }
  }

  if (build) {
    for (const id of build) {
      if (id === '') {
        throw new SyntaxError('Invalid build identifier');
      }
    }
  }

  return { major, minor, patch, prerelease };
}

function compareSemver(a, b) {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  const majCmp = compareBigIntStrings(parsedA.major, parsedB.major);
  if (majCmp !== 0) return majCmp;

  const minCmp = compareBigIntStrings(parsedA.minor, parsedB.minor);
  if (minCmp !== 0) return minCmp;

  const patCmp = compareBigIntStrings(parsedA.patch, parsedB.patch);
  if (patCmp !== 0) return patCmp;

  const preA = parsedA.prerelease;
  const preB = parsedB.prerelease;

  if (preA === null && preB !== null) return 1;
  if (preA !== null && preB === null) return -1;
  if (preA === null && preB === null) return 0;

  const len = Math.max(preA.length, preB.length);
  for (let i = 0; i < len; i++) {
    if (preA[i] === undefined) return -1;
    if (preB[i] === undefined) return 1;

    const idA = preA[i];
    const idB = preB[i];

    const isNumA = /^[0-9]+$/.test(idA);
    const isNumB = /^[0-9]+$/.test(idB);

    if (isNumA && isNumB) {
      const numCmp = compareBigIntStrings(idA, idB);
      if (numCmp !== 0) return numCmp;
    } else if (isNumA && !isNumB) {
      return -1;
    } else if (!isNumA && isNumB) {
      return 1;
    } else {
      if (idA !== idB) {
        return idA < idB ? -1 : 1;
      }
    }
  }

  if (preA.length !== preB.length) {
    return preA.length < preB.length ? -1 : 1;
  }

  return 0;
}

module.exports = { compareSemver };
