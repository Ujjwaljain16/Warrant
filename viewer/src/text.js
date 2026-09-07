'use strict';

// Display hygiene for untrusted strings. The page never builds markup from log text (everything goes through
// textContent), but a string can still mislead a reader: bidi overrides reorder what is shown, zero-width and
// control characters hide content, and one unbroken megabyte string wrecks a layout. This makes such characters
// visible and caps length. Implemented with code-point ranges rather than a regex so the source stays plain ASCII.

const HIDDEN_RANGES = [
  [0x0000, 0x001F], [0x007F, 0x009F], [0x00AD, 0x00AD], [0x061C, 0x061C], [0x180E, 0x180E],
  [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB],
];
const ELLIPSIS = String.fromCharCode(0x2026);
const REPLACEMENT = String.fromCharCode(0xFFFD);

function isHidden(code) {
  for (const [lo, hi] of HIDDEN_RANGES) if (code >= lo && code <= hi) return true;
  return false;
}

function label(code) {
  return `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`;
}

// Replace invisible and direction-changing characters (and lone surrogates) with a visible marker.
// `multiline` keeps line feeds and tabs, for text the page itself laid out (pretty-printed JSON).
function revealHidden(value, multiline = false) {
  const text = String(value);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { out += text[i] + text[i + 1]; i++; } else out += REPLACEMENT;
    } else if (code >= 0xDC00 && code <= 0xDFFF) out += REPLACEMENT;
    else if (isHidden(code) && !(multiline && (code === 10 || code === 9))) out += label(code);
    else out += text[i];
  }
  return out;
}

// revealHidden plus a length cap (in UTF-16 units of the original text, never splitting a surrogate pair).
// Only the kept prefix is scanned, so a megabyte string costs the same as a short one.
function clip(value, max = 200, multiline = false) {
  const text = String(value);
  if (text.length <= max) return revealHidden(text, multiline);
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
  return `${revealHidden(text.slice(0, end), multiline)}${ELLIPSIS} (+${text.length - end} chars)`;
}

// Safe one-line rendering of an arbitrary JSON value.
function show(value, max = 200) {
  if (typeof value === 'string') return clip(value, max);
  if (value === undefined) return '';
  let text;
  try { text = JSON.stringify(value); } catch (_error) { text = String(value); }
  return clip(text === undefined ? String(value) : text, max);
}

module.exports = { clip, revealHidden, show };
