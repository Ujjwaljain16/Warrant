'use strict';

// Best-effort redaction for text that might reach a log (error messages, command output snippets).
// The run log is designed to carry digests and short codes, not bodies; this is a second line of defence.
const PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api-key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:jwt]'],
  [/(\b(?:password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*)(["']?)[^\s"',;]{4,}\2/gi, '$1[REDACTED]'],
];

function redact(text, maxLength = 500) {
  let out = String(text);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}...[truncated]` : out;
}

module.exports = Object.freeze({ redact });
