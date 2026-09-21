'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalRequest } = require('./canonical');
const { LiveDisabledError, LlmError, MissingKeyError, QuotaExhaustedError } = require('./errors');
const { resolveModel } = require('./limits');
const { DailyCounter, RateLimiter, warrantHome } = require('./quota');
const { redactSecrets } = require('./secrets');

// Gemini REST adapter (generateContent). Shapes checked against ai.google.dev/api/generate-content:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   header  x-goog-api-key: <key>            (the key never goes in the URL)
//   body    { systemInstruction: {parts:[{text}]}, contents: [{role: user|model, parts:[{text}]}],
//             generationConfig: { maxOutputTokens, temperature } }
//   reply   { candidates: [{ content: {parts:[{text, thought?}]}, finishReason }],
//             usageMetadata: { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount },
//             promptFeedback?: { blockReason } }
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 5;
const MAX_SERVER_DELAY_MS = 120_000; // longest Retry-After / retryDelay the client will sit through

const FINISH = { STOP: 'stop', MAX_TOKENS: 'length' };
const BLOCKED = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'];

function keyFilePath(env) {
  return path.join(warrantHome(env), 'gemini.key');
}

function loadApiKey(env = process.env) {
  const fromEnv = env.GEMINI_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const file = keyFilePath(env);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { throw new MissingKeyError(file); }
  const key = text.trim();
  if (!key) throw new MissingKeyError(file);
  return key;
}

// ~4 characters per token: only used to pace requests before the provider reports real usage.
function estimateTokens(request) {
  const chars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4);
}

// Gemma 4 thinks by default, which took ~100 s per call in the dev run (a 20-step episode would exceed the wall-clock limit and
// the 16K tokens/minute quota). It supports switching thinking off with thinkingLevel "minimal" (ai.google.dev/gemma/docs/core/gemma_on_gemini_api);
// the agent protocol asks for one JSON action per turn and needs no reasoning mode. Gemini flash-lite models use the API default.
const THINKING_LEVELS = Object.freeze({ 'gemma-4-31b-it': 'minimal', 'gemma-4-26b-a4b-it': 'minimal' });

function buildBody(request) {
  const body = {
    contents: request.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: request.maxOutputTokens, temperature: request.temperature },
  };
  const level = Object.hasOwn(THINKING_LEVELS, resolveModel(request.model)) ? THINKING_LEVELS[resolveModel(request.model)] : null;
  if (level) body.generationConfig.thinkingConfig = { thinkingLevel: level };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  return body;
}

// Token counts come off the network: only finite, non-negative numbers are believed (anything else counts as 0).
function tokenCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1e9) : 0;
}

function parseResponse(json) {
  const candidate = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  const usage = (json && json.usageMetadata) || {};
  const usageOut = {
    inputTokens: tokenCount(usage.promptTokenCount),
    // Thinking tokens are billed (and rate limited) as output.
    outputTokens: tokenCount(usage.candidatesTokenCount) + tokenCount(usage.thoughtsTokenCount),
  };
  if (!candidate) {
    const blocked = json && json.promptFeedback && json.promptFeedback.blockReason;
    if (blocked) return { text: '', usage: usageOut, finishReason: 'blocked' };
    throw new LlmError('BAD_RESPONSE', 'response had no candidates');
  }
  const parts = (candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : [];
  const text = parts.filter((p) => p && typeof p.text === 'string' && p.thought !== true).map((p) => p.text).join('');
  const raw = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'STOP';
  let finishReason = 'other';
  if (Object.hasOwn(FINISH, raw)) finishReason = FINISH[raw];
  else if (BLOCKED.includes(raw)) finishReason = 'blocked';
  return { text, usage: usageOut, finishReason };
}

// Provider error bodies are {error:{code,status,message,details:[...]}}; the newer API also uses {error:{code:'quota_exceeded',message}}.
function describeError(bodyText, redact = (s) => s) {
  let parsed = null;
  try { parsed = JSON.parse(bodyText); } catch (_error) { /* not JSON */ }
  const err = parsed && parsed.error ? parsed.error : {};
  const details = Array.isArray(err.details) ? err.details : [];
  const text = `${err.code || ''} ${err.status || ''} ${err.message || ''} ${JSON.stringify(details)}`;
  const daily = /perday|per day|per_day|quota_exceeded|daily/i.test(text);
  let retryAfterMs = null;
  for (const d of details) {
    if (d && typeof d.retryDelay === 'string') {
      const m = /^([0-9.]+)s$/.exec(d.retryDelay);
      if (m) retryAfterMs = Math.ceil(Number(m[1]) * 1000);
    }
  }
  return { message: typeof err.message === 'string' ? redact(err.message) : redact(String(bodyText)).slice(0, 300), daily, retryAfterMs };
}

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

class GeminiClient {
  #env;
  #key = null; // private: never visible to JSON.stringify, util.inspect, Object.keys or a spread of the client

  constructor({
    env = process.env, fetchImpl = globalThis.fetch, counter = new DailyCounter(), limiter = new RateLimiter(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random,
    maxCalls = Infinity, requestTimeoutMs = 120_000, maxRetries = MAX_RETRIES, onEvent = null,
  } = {}) {
    this.#env = env; // private as well: when the key comes from the environment, the environment holds it
    this.fetchImpl = fetchImpl;
    this.counter = counter;
    this.limiter = limiter;
    this.sleep = sleep;
    this.random = random;
    this.maxCalls = maxCalls; // hard cap on HTTP requests made by this client instance (belt and braces for scripted runs)
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxRetries = maxRetries;
    this.httpCalls = 0;
    this.onEvent = onEvent; // optional diagnostics hook: ({ type, model, attempt, ms, status?, message? }); never receives the key
  }

  _emit(event) {
    if (this.onEvent) { try { this.onEvent(event); } catch (_error) { /* diagnostics must never break a call */ } }
  }

  _redact(text) {
    return redactSecrets(text, this.#key ? [this.#key] : []);
  }

  async generate(rawRequest, { signal } = {}) {
    const request = canonicalRequest(rawRequest);
    const model = resolveModel(request.model);
    if (this.#env.WARRANT_LIVE !== '1') throw new LiveDisabledError();
    if (!this.#key) this.#key = loadApiKey(this.#env);
    const body = JSON.stringify(buildBody(request));
    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    let lastDetail = 'no attempt made';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.counter.isExhausted(model)) throw new QuotaExhaustedError(model, 'daily request counter is at the limit');
      if (this.httpCalls >= this.maxCalls) throw new LlmError('CALL_CAP', `client call cap of ${this.maxCalls} reached`);
      await this.limiter.acquire(model, estimateTokens(request));
      if (signal && signal.aborted) throw new LlmError('ABORTED', 'generate aborted');
      this.httpCalls++;
      this.counter.increment(model);

      let response;
      let text;
      const startedAt = Date.now();
      try {
        const timeout = AbortSignal.timeout(this.requestTimeoutMs);
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.#key },
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        text = await response.text();
      } catch (error) {
        if (signal && signal.aborted) throw new LlmError('ABORTED', 'generate aborted');
        lastDetail = `network error: ${this._redact(error && error.message ? error.message : String(error))}`;
        this._emit({ type: 'network_error', model, attempt, ms: Date.now() - startedAt, message: lastDetail.slice(0, 200) });
        if (attempt === this.maxRetries) throw new LlmError('NETWORK', lastDetail);
        await this.sleep(this._backoff(attempt, null));
        continue;
      }

      if (response.ok) {
        this._emit({ type: 'ok', model, attempt, ms: Date.now() - startedAt });
        let json;
        try { json = JSON.parse(text); } catch (_error) { throw new LlmError('BAD_RESPONSE', 'response was not JSON'); }
        const result = parseResponse(json);
        if (result.usage.inputTokens > 0) this.limiter.correctLast(model, result.usage.inputTokens);
        return result;
      }

      const info = describeError(text, (s) => this._redact(s));
      const message = this._redact(info.message);
      lastDetail = `HTTP ${response.status}: ${message}`;
      this._emit({ type: 'http_error', model, attempt, ms: Date.now() - startedAt, status: response.status, message: message.slice(0, 200) });
      if (response.status === 429) {
        if (info.daily) {
          this.counter.markExhausted(model);
          throw new QuotaExhaustedError(model, message, { status: 429 });
        }
        if (attempt === this.maxRetries) throw new LlmError('RATE_LIMITED', lastDetail, { status: 429 });
        const wanted = parseRetryAfter(response.headers.get('retry-after')) ?? info.retryAfterMs;
        if (wanted !== null && wanted !== undefined && wanted > MAX_SERVER_DELAY_MS) throw new LlmError('RATE_LIMITED', `${lastDetail} (the server asked for a ${Math.round(wanted / 1000)} s pause; the client waits at most ${MAX_SERVER_DELAY_MS / 1000} s)`, { status: 429 });
        await this.sleep(this._backoff(attempt, wanted));
        continue;
      }
      if (response.status >= 500 || response.status === 408) {
        if (attempt === this.maxRetries) throw new LlmError('SERVER_ERROR', lastDetail, { status: response.status });
        const asked = parseRetryAfter(response.headers.get('retry-after'));
        if (asked !== null && asked > MAX_SERVER_DELAY_MS) throw new LlmError('SERVER_ERROR', `${lastDetail} (the server asked for a ${Math.round(asked / 1000)} s pause; the client waits at most ${MAX_SERVER_DELAY_MS / 1000} s)`, { status: response.status });
        await this.sleep(this._backoff(attempt, asked));
        continue;
      }
      // 4xx other than 408/429 are our fault (bad key, bad model, bad request): never retried.
      throw new LlmError('HTTP_ERROR', lastDetail, { status: response.status });
    }
    throw new LlmError('EXHAUSTED_RETRIES', lastDetail);
  }

  // Exponential backoff with jitter; a server-provided delay is a floor.
  _backoff(attempt, serverMs) {
    const exp = Math.min(60_000, 1000 * 2 ** attempt);
    const jittered = exp / 2 + this.random() * (exp / 2);
    return serverMs === null || serverMs === undefined ? jittered : Math.max(serverMs, 0) + Math.floor(this.random() * 250);
  }
}

module.exports = Object.freeze({ GeminiClient, MAX_SERVER_DELAY_MS, THINKING_LEVELS, buildBody, describeError, estimateTokens, keyFilePath, loadApiKey, parseResponse });
