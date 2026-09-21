'use strict';

const { redact } = require('../util/redact');

// Key-shaped strings that must never reach an error message, log, cassette or document.
// Extends util/redact.js (not edited) with Google API key shapes and with exact known secret values.
const EXTRA_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED:google-api-key]'],
  [/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]'],
];

// A text that was cut in the middle of a known secret ends in a prefix of it: remove such a tail (12 or more characters of the secret).
function stripSecretTail(text, secret) {
  for (let n = Math.min(secret.length - 1, text.length); n >= 12; n--) if (text.endsWith(secret.slice(0, n))) return `${text.slice(0, text.length - n)}[REDACTED:key]`;
  return text;
}

function redactSecrets(text, knownSecrets = [], maxLength = 2000) {
  let out = String(text);
  for (const secret of knownSecrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = stripSecretTail(out.split(secret).join('[REDACTED:key]'), secret);
  }
  for (const [pattern, replacement] of EXTRA_PATTERNS) out = out.replace(pattern, replacement);
  return redact(out, maxLength);
}

module.exports = Object.freeze({ redactSecrets });
