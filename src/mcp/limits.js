'use strict';

// Hard limits of the MCP server. Every one of them exists because the model on the other end is untrusted.
const LIMITS = Object.freeze({
  maxRequestBytes: 128 * 1024,       // one JSON-RPC line from the client
  maxResultBytes: 32 * 1024,         // the text of one tool result
  maxSpecBytes: 1024 * 1024,         // one spec file
  maxStateFileBytes: 4 * 1024 * 1024, // one file the server wrote into --state-dir (meta, spec copy, report)
  maxLogBytes: 16 * 1024 * 1024,     // one run log
  maxSpecsListed: 200,
  maxTaskIdsListed: 50,
  maxDescriptionChars: 200,
  maxViolations: 50,
  maxRecentEvents: 10,
  maxConcurrency: 64,
  defaultMaxRunMs: 10 * 60 * 1000,
  ceilingMaxRunMs: 24 * 60 * 60 * 1000,
  defaultSyncWaitMs: 20 * 1000,
  killGraceMs: 3000,
});

const REPLACEMENT = String.fromCharCode(0xfffd);
const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029]+', 'g');

// Replaces control characters (including newlines and line separators) with spaces and bounds the length. Anything that
// came from a spec, a log or a worker passes through here before it is shown to a model.
function cleanText(value, max = 200) {
  const text = String(value).replace(CONTROL_CHARS, ' ').trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}...[truncated]` : text;
}

// cleanText applied to every string in a JSON value (keys of a log or report are ours; the values may not be).
function cleanDeep(value, max = 300, depth = 0) {
  if (typeof value === 'string') return cleanText(value, max);
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 256).map((v) => cleanDeep(v, max, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 256).map(([k, v]) => [k, cleanDeep(v, max, depth + 1)]));
}

function truncateUtf8(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let out = buf.subarray(0, Math.max(0, maxBytes)).toString('utf8');
  while (out.endsWith(REPLACEMENT)) out = out.slice(0, -1); // a character cut in half decodes to U+FFFD
  return out;
}

// Bounds a tool result. A value that fits is returned unchanged; one that does not is replaced by an object that says,
// explicitly, that it was truncated and carries a prefix of the original as a string.
function fitResult(data, maxBytes = LIMITS.maxResultBytes) {
  const text = JSON.stringify(data, null, 2);
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxBytes) return { data, text };
  const compact = JSON.stringify(data);
  const marker = `[truncated: the result was ${bytes} bytes; the limit is ${maxBytes}. The preview below is only a prefix.]`;
  let budget = Math.max(0, maxBytes - 512);
  for (;;) {
    const out = { truncated: true, marker, original_bytes: bytes, preview: truncateUtf8(compact, budget) };
    const outText = JSON.stringify(out, null, 2);
    if (Buffer.byteLength(outText) <= maxBytes || budget === 0) return { data: out, text: outText };
    budget = Math.floor(budget * 0.8);
  }
}

module.exports = Object.freeze({ LIMITS, cleanDeep, cleanText, fitResult, truncateUtf8 });
