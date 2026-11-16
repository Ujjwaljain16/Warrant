'use strict';

const UPPER = /^[A-Z]$/;
const LOWER = /^[a-z]$/;
const LOWER_OR_DIGIT = /^[a-z0-9]$/;

function camelToSnake(name) {
  if (typeof name !== 'string') {
    throw new TypeError('camelToSnake expects a string');
  }

  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (!UPPER.test(c)) {
      out += c;
      continue;
    }

    const prev = i > 0 ? name[i - 1] : '';
    const next = i + 1 < name.length ? name[i + 1] : '';

    // Start of a new word: after a lower-case letter or digit, or at the
    // last capital of an acronym run that is followed by a lower-case letter.
    const startsWord =
      LOWER_OR_DIGIT.test(prev) || (UPPER.test(prev) && LOWER.test(next));

    if (startsWord) {
      out += '_';
    }
    out += c.toLowerCase();
  }
  return out;
}

module.exports = { camelToSnake };
