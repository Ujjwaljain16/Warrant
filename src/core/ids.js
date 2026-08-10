'use strict';

// Identifier syntax shared with the vendored upstream (third_party/citadel/core/operations/validation.js):
// lowercase, starts with a letter, segments joined by - _ . :
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const ARTIFACT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

function isId(value) {
  return typeof value === 'string' && value.length <= 128 && ID_PATTERN.test(value);
}

// Windows device names (con, nul, com1, ...) resolve to devices rather than files, with or without an extension,
// and Windows silently strips trailing dots; neither is acceptable as an artifact file name on any platform.
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function isArtifactName(value) {
  return typeof value === 'string' && ARTIFACT_NAME_PATTERN.test(value) && !value.includes('..')
    && !value.endsWith('.') && !RESERVED_NAME.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Returns the dotted path of the first forbidden key found at any depth, or null.
function findForbiddenKey(value, path = '$', depth = 0) {
  if (depth > 32) return path + '(too deep)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (FORBIDDEN_KEYS.includes(key)) return `${path}.${key}`;
      const hit = findForbiddenKey(value[key], `${path}.${key}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

module.exports = Object.freeze({
  ARTIFACT_NAME_PATTERN, FORBIDDEN_KEYS, ID_PATTERN, SHA256_HEX,
  findForbiddenKey, isArtifactName, isId, isPlainObject,
});
