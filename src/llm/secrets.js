'use strict';

const { redact } = require('../util/redact');

// Key-shaped strings that must never reach an error message, log, cassette or document.
// Extends util/redact.js (not edited) with Google API key shapes and with exact known secret values.
const EXTRA_PATTERNS = [
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED:google-api-key]'],
  [/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]'],
];

function redactSecrets(text, knownSecrets = [], maxLength = 2000) {
  let out = String(text);
  for (const secret of knownSecrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[REDACTED:key]');
  }
  for (const [pattern, replacement] of EXTRA_PATTERNS) out = out.replace(pattern, replacement);
  return redact(out, maxLength);
}

module.exports = Object.freeze({ redactSecrets });
