'use strict';

// JSONL parsing with the same torn-tail rule as src/log/runlog.js parseLines:
//   * the final line is "torn" when it is not valid JSON, or when the file does not end with a newline
//     (a complete entry is always written with its newline);
//   * an invalid line anywhere else is corruption.
// Unlike the engine, which stops at the first corruption, the viewer records the problem and keeps reading, so a
// damaged log can still be inspected. Everything at and after the first problem is reported as unverified.

const LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxEntries: 100000,
  maxLineChars: 1000000,
});

function parseLog(input, limits = LIMITS) {
  let text = String(input);
  let bom = false;
  if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); bom = true; }
  const lines = text.split('\n');
  const endsClean = text.endsWith('\n');
  const result = { entries: [], lineNumbers: [], problems: [], torn: null, bom, truncated: false, lineCount: 0 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    if (isLast && line === '') break;
    result.lineCount = i + 1;
    if (result.entries.length >= limits.maxEntries) { result.truncated = true; break; }
    let parsed;
    let tooLong = false;
    if (line.length > limits.maxLineChars) tooLong = true;
    else {
      try { parsed = JSON.parse(line); } catch (_error) { parsed = undefined; }
    }
    if (parsed === undefined || (isLast && !endsClean)) {
      if (isLast) { result.torn = { line: i + 1, chars: line.length, parseable: parsed !== undefined }; continue; }
      result.problems.push({
        line: i + 1,
        afterEntries: result.entries.length,
        kind: tooLong ? 'line_too_long' : 'invalid_json',
        message: tooLong ? `line ${i + 1} is longer than ${limits.maxLineChars} characters` : `line ${i + 1} is not valid JSON`,
      });
      continue;
    }
    result.entries.push(parsed);
    result.lineNumbers.push(i + 1);
  }
  return result;
}

// A spec is one JSON document with a `tasks` array; a log is many JSON lines. Used to tell dropped files apart.
function classifyText(text) {
  const raw = String(text);
  const trimmed = (raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw).trim();
  if (trimmed === '') return { kind: 'empty' };
  let whole;
  try { whole = JSON.parse(trimmed); } catch (_error) { whole = undefined; }
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) {
    if (Array.isArray(whole.tasks) && (whole.spec_version !== undefined || whole.run_id !== undefined)) return { kind: 'spec', value: whole };
    if (typeof whole.seq === 'number' && typeof whole.type === 'string') return { kind: 'log' };
    return { kind: 'unknown' };
  }
  return { kind: 'log' };
}

module.exports = { LIMITS, classifyText, parseLog };
