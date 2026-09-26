'use strict';

function compareSemver(a, b) {
  if (typeof a !== 'string') throw new TypeError('Version a must be a string');
  if (typeof b !== 'string') throw new TypeError('Version b must be a string');

  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  if (versionA.major !== versionB.major) {
    return versionA.major < versionB.major ? -1 : 1;
  }
  if (versionA.minor !== versionB.minor) {
    return versionA.minor < versionB.minor ? -1 : 1;
  }
  if (versionA.patch !== versionB.patch) {
    return versionA.patch < versionB.patch ? -1 : 1;
  }

  const aHasPrerelease = versionA.prerelease !== null;
  const bHasPrerelease = versionB.prerelease !== null;

  if (aHasPrerelease && !bHasPrerelease) return -1;
  if (!aHasPrerelease && bHasPrerelease) return 1;
  if (aHasPrerelease && bHasPrerelease) {
    const preCompare = comparePrerelease(versionA.prerelease, versionB.prerelease);
    if (preCompare !== 0) return preCompare;
  }

  return 0;
}

function parseVersion(versionStr) {
  const match = versionStr.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
  );

  if (!match) {
    throw new SyntaxError(`Invalid version string: ${versionStr}`);
  }

  const [, majorStr, minorStr, patchStr, prerelease] = match;

  return {
    major: BigInt(majorStr),
    minor: BigInt(minorStr),
    patch: BigInt(patchStr),
    prerelease: prerelease ? prerelease.split('.') : null
  };
}

function comparePrerelease(preTags1, preTags2) {
  const len = Math.min(preTags1.length, preTags2.length);

  for (let i = 0; i < len; i++) {
    const tag1 = preTags1[i];
    const tag2 = preTags2[i];

    const isNum1 = /^\d+$/.test(tag1);
    const isNum2 = /^\d+$/.test(tag2);

    if (isNum1 && isNum2) {
      const num1 = BigInt(tag1);
      const num2 = BigInt(tag2);
      if (num1 !== num2) {
        return num1 < num2 ? -1 : 1;
      }
    } else if (isNum1) {
      return -1;
    } else if (isNum2) {
      return 1;
    } else {
      if (tag1 !== tag2) {
        return tag1 < tag2 ? -1 : 1;
      }
    }
  }

  if (preTags1.length !== preTags2.length) {
    return preTags1.length < preTags2.length ? -1 : 1;
  }

  return 0;
}

module.exports = { compareSemver };