'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalRequest, requestKey } = require('./canonical');
const { CassetteMissError, LlmError } = require('./errors');

// Record/replay wrapper around any LlmClient.
//
//   mode 'record'           every call goes to the inner client and is appended to the cassette
//   mode 'replay'           every call must be in the cassette; a miss is a hard error (CassetteMissError)
//   mode 'replay-then-live' recorded calls are replayed; a miss goes to the inner client and is appended
//
// Cassette format (JSONL, one object per line, append-only):
//   {"key": sha256(canonical request), "n": occurrence index of that key, "request": {...canonical...},
//    "response": {"text","usage":{"inputTokens","outputTokens"},"finishReason"}}
// The key covers model, system, messages, maxOutputTokens, temperature, and nothing else: never headers or keys.
// The nth call with a given key replays the nth recorded response for it, so a run that repeats an identical
// request (e.g. an agent retrying) replays exactly as it was recorded. No timestamps are stored, so replay output
// depends only on the file's bytes.
const MODES = Object.freeze(['record', 'replay', 'replay-then-live']);

function canonicalResponse(response) {
  const usage = response.usage || {};
  return {
    text: String(response.text),
    usage: { inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0 },
    finishReason: String(response.finishReason),
    ...provenance(response),
  };
}

// Router replies carry where the answer came from; it is kept (the replay is byte-identical either way) so a cassette can be audited
// against the router's own records. Absent for every other client, so existing cassettes and their replay are unchanged.
function provenance(response) {
  const out = {};
  if (typeof response.servedModel === 'string') out.servedModel = response.servedModel.slice(0, 120);
  if (typeof response.requestId === 'string') out.requestId = response.requestId.slice(0, 120);
  if (Number.isFinite(response.costUsd) && response.costUsd >= 0) out.costUsd = response.costUsd;
  return out;
}

const FINISH_REASONS = Object.freeze(['stop', 'length', 'blocked', 'other']);
const isCount = (n) => Number.isFinite(n) && n >= 0;

// Throws a description of what is wrong with a stored response, or returns it unchanged.
function validateResponse(response) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) throw new Error('response is not an object');
  if (typeof response.text !== 'string') throw new Error('response.text is not a string');
  const usage = response.usage;
  if (usage === null || typeof usage !== 'object' || !isCount(usage.inputTokens) || !isCount(usage.outputTokens)) throw new Error('response.usage needs finite non-negative inputTokens and outputTokens');
  if (!FINISH_REASONS.includes(response.finishReason)) throw new Error('response.finishReason is not a known value');
  return response;
}

function loadCassette(file) {
  const entries = new Map(); // `${key}#${n}` -> response
  const counts = new Map(); // key -> number recorded
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { entries, counts };
    throw error;
  }
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let parsed;
    try { parsed = JSON.parse(line); } catch (_error) { throw new LlmError('BAD_CASSETTE', `${file}:${i + 1} is not valid JSON`); }
    if (!parsed || typeof parsed.key !== 'string' || !Number.isInteger(parsed.n) || parsed.n < 0 || !parsed.response) throw new LlmError('BAD_CASSETTE', `${file}:${i + 1} is malformed`);
    try { validateResponse(parsed.response); } catch (error) { throw new LlmError('BAD_CASSETTE', `${file}:${i + 1}: ${error.message}`); }
    // When the full request is stored, the key must be the key of that request: a hand-edited entry can not answer for another prompt.
    if (parsed.request !== undefined) {
      let actual = null;
      try { actual = requestKey(parsed.request); } catch (_error) { /* reported below */ }
      if (actual !== parsed.key) throw new LlmError('BAD_CASSETTE', `${file}:${i + 1}: the stored request does not match its key`);
    }
    entries.set(`${parsed.key}#${parsed.n}`, parsed.response);
    counts.set(parsed.key, Math.max(counts.get(parsed.key) || 0, parsed.n + 1));
  });
  return { entries, counts };
}

class CassetteClient {
  constructor({ file, mode, inner = null, storeRequest = true }) {
    if (!MODES.includes(mode)) throw new TypeError(`mode must be one of ${MODES.join(', ')}`);
    if (mode !== 'replay' && !inner) throw new TypeError(`mode ${mode} needs an inner client`);
    this.file = path.resolve(file);
    this.storeRequest = storeRequest; // false: keep only key + response (the benchmark keeps conversations in its transcripts)
    this.mode = mode;
    this.inner = inner;
    const loaded = loadCassette(this.file);
    this.entries = loaded.entries;
    this.recorded = loaded.counts;
    this.served = new Map(); // key -> calls served in this process
    this.stats = { replayed: 0, live: 0 };
  }

  async generate(rawRequest, opts) {
    const request = canonicalRequest(rawRequest);
    const key = requestKey(request);
    const n = this.served.get(key) || 0;
    if (this.mode !== 'record') {
      const hit = this.entries.get(`${key}#${n}`);
      if (hit) {
        this.served.set(key, n + 1);
        this.stats.replayed++;
        return structuredClone(hit);
      }
      if (this.mode === 'replay') throw new CassetteMissError(key, n, path.basename(this.file));
    }
    const response = canonicalResponse(await this.inner.generate(request, opts));
    // In record mode an existing cassette is extended: the new occurrence follows whatever is already recorded.
    const occurrence = this.mode === 'record' ? (this.recorded.get(key) || 0) : n;
    this._append({ key, n: occurrence, request, response });
    this.entries.set(`${key}#${occurrence}`, response);
    this.recorded.set(key, occurrence + 1);
    this.served.set(key, n + 1);
    this.stats.live++;
    return structuredClone(response);
  }

  _append(line) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const entry = this.storeRequest
      ? { key: line.key, n: line.n, request: line.request, response: line.response }
      : { key: line.key, n: line.n, model: line.request.model, response: line.response };
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }
}

module.exports = Object.freeze({ CassetteClient, MODES, canonicalResponse, loadCassette, validateResponse });
