'use strict';

function compareSemver(a, b) {
  // Type check
  if (typeof a !== 'string') throw new TypeError('Version must be a string');
  if (typeof b !== 'string') throw new TypeError('Version must be a string');

  // Parse versions
  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  // Compare MAJOR, MINOR, PATCH
  const coreCompare = compareBigInt(versionA.major, versionB.major)
    || compareBigInt(versionA.minor, versionB.minor)
    || compareBigInt(versionA.patch, versionB.patch);
  
  if (coreCompare !== 0) return coreCompare;

  // A version with a pre-release is lower than the same version without one
  if (versionA.prerelease === null && versionB.prerelease !== null) return 1;
  if (versionA.prerelease !== null && versionB.prerelease === null) return -1;

  // If both have pre-releases, compare them
  if (versionA.prerelease !== null && versionB.prerelease !== null) {
    return comparePrerelease(versionA.prerelease, versionB.prerelease);
  }

  // Same version, build metadata ignored
  return 0;
}

function parseVersion(versionStr) {
  // Format: MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
  const match = versionStr.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
  );

  if (!match) {
    throw new SyntaxError(`Invalid version string: ${versionStr}`);
  }

  const [, major, minor, patch, prerelease, build] = match;

  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease: prerelease ? prerelease.split('.') : null,
    build: build
  };
}

function compareBigInt(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePrerelease(preA, preB) {
  const minLen = Math.min(preA.length, preB.length);

  for (let i = 0; i < minLen; i++) {
    const idA = preA[i];
    const idB = preB[i];

    // Check if identifiers are numeric
    const isNumA = /^\d+$/.test(idA);
    const isNumB = /^\d+$/.test(idB);

    if (isNumA && isNumB) {
      // Both numeric: compare as numbers
      const numA = BigInt(idA);
      const numB = BigInt(idB);
      const cmp = compareBigInt(numA, numB);
      if (cmp !== 0) return cmp;
    } else if (isNumA) {
      // A is numeric, B is text: A is lower
      return -1;
    } else if (isNumB) {
      // B is numeric, A is text: B is lower
      return 1;
    } else {
      // Both text: compare as ASCII strings
      if (idA < idB) return -1;
      if (idA > idB) return 1;
    }
  }

  // All shared identifiers are equal
  // The one with more identifiers is higher
  if (preA.length < preB.length) return -1;
  if (preA.length > preB.length) return 1;
  return 0;
}

module.exports = { compareSemver };
