'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalRequest, requestKey } = require('./canonical');
const { LiveDisabledError, LlmError, QuotaExhaustedError } = require('./errors');
const { warrantHome } = require('./quota');
const { BudgetExhaustedError, RouterBudget, fetchCredits } = require('./router-budget');
const {
  ALLOWED_MODELS, ROUTER_BASE_URL, RouterCatalog, RouterModelError, checkBaseUrl, costUsd, estimateInputTokens, loadRouterKey, redactRouter, servedModelMatches,
} = require('./router-models');

// LlmClient for an OpenAI-compatible router (CloseRouter): POST {base}/chat/completions, non-streaming.
//   header  Authorization: Bearer <key>           (the key never goes in the URL, a log or an error message)
//   body    { model, messages: [{role: system|user|assistant, content}], max_tokens, temperature, stream: false }
//   reply   { id, model, choices: [{ message: {content, reasoning?}, finish_reason }],
//             usage: { prompt_tokens, completion_tokens, completion_tokens_details: {reasoning_tokens}, prompt_tokens_details: {cached_tokens} } }
//
// Same generate() contract as the Gemini adapter, plus costUsd, servedModel, requestId, usageEstimated and reasoningTokens on the
// result. Safety, in the order a call meets it:
//   1. only allowlisted models, only with WARRANT_LIVE=1, only after GET /models shows the model listed and not >3x dearer;
//   2. a pre-flight worst case is reserved in the persistent ledger (RouterBudget) or the call is refused (BudgetExhaustedError);
//   3. the reply is validated strictly; a reply naming a different model is an error, so the caller (and CassetteClient) never
//      records it; its cost is still charged;
//   4. the real cost, from the usage the API reported, settles the reservation.
const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_BODY_CHARS = 16 * 1024 * 1024;
// Per-call ceilings, so a runaway (a huge limit, a giant prompt, a reasoning model that ignores its limit) can never burn the budget:
// the agent loop asks for 8192 output tokens and the judge for 4096; nothing may ask for more, and no single call may be able to cost over a cent.
const MAX_OUTPUT_TOKENS_CEILING = 8192;
const MAX_CALL_USD = 0.01;
// A reply billed for more output than its limit by this much (25% plus 64 tokens: hidden reasoning is reported separately by some models) means the model is not honouring max_tokens.
const OVERRUN_FACTOR = 1.25;
const OVERRUN_SLACK_TOKENS = 64;
const REQUEST_ID_HEADERS = ['x-request-id', 'request-id', 'x-closerouter-request-id', 'cf-ray'];
// Connection errors that mean the request never left this machine, so nothing can have been billed.
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const FINISH = { stop: 'stop', length: 'length', content_filter: 'blocked' };

// The router answered with a different model than the one asked for. The experiment is invalid if that goes on, so this stops the
// model's lane like an exhausted quota (it extends QuotaExhaustedError, which the runner already handles) instead of counting as a failed run.
class ModelMismatchError extends QuotaExhaustedError {
  constructor(requested, served, cost) {
    super(requested, 'identity check failed', { servedModel: served, costUsd: cost });
    this.name = 'ModelMismatchError';
    this.code = 'MODEL_MISMATCH';
    this.message = `requested ${requested} but the router served ${served === null ? 'an unnamed model' : `"${served}"`}; the reply was discarded (and charged ${cost.toFixed(6)} USD)`;
  }
}

const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// usage -> {inputTokens, outputTokens, cachedTokens, reasoningTokens}, or null when the reply reports no usable usage.
// Reasoning ("thinking") tokens are normally part of completion_tokens; when the reply reports more reasoning tokens than
// completion tokens, they obviously are not, so they are added: the cost never uses less than what the API says it generated.
function readUsage(json) {
  const u = json && typeof json === 'object' ? json.usage : null;
  if (!u || typeof u !== 'object' || !isCount(u.prompt_tokens) || !isCount(u.completion_tokens)) return null;
  const reasoning = u.completion_tokens_details && isCount(u.completion_tokens_details.reasoning_tokens) ? u.completion_tokens_details.reasoning_tokens : 0;
  const cached = u.prompt_tokens_details && isCount(u.prompt_tokens_details.cached_tokens) ? u.prompt_tokens_details.cached_tokens : 0;
  return {
    inputTokens: Math.ceil(u.prompt_tokens),
    outputTokens: Math.ceil(reasoning > u.completion_tokens ? u.completion_tokens + reasoning : u.completion_tokens),
    cachedTokens: Math.min(Math.ceil(cached), Math.ceil(u.prompt_tokens)),
    reasoningTokens: Math.ceil(reasoning),
    // The router also reports what it charged for the call (usage.cost, in USD); when it is higher than the price table says, it wins.
    reportedCostUsd: isCount(u.cost) ? u.cost : null,
  };
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p && typeof p === 'object' && (p.type === undefined || p.type === 'text') && typeof p.text === 'string').map((p) => p.text).join('');
  }
  return null;
}

// Reply text and finish reason, or an LlmError('BAD_RESPONSE'). Never throws anything else, whatever the body looks like.
function readChoice(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  if (!choice || typeof choice !== 'object') throw new LlmError('BAD_RESPONSE', 'response had no choices');
  const message = choice.message;
  if (!message || typeof message !== 'object') throw new LlmError('BAD_RESPONSE', 'response choice had no message');
  const raw = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
  const finishReason = raw !== null && Object.hasOwn(FINISH, raw) ? FINISH[raw] : 'other';
  let text = contentText(message.content);
  if (text === null) {
    // content: null is legitimate when a reasoning model spent its whole budget thinking (length) or the reply was filtered.
    if (message.content === null && (finishReason === 'length' || finishReason === 'blocked')) text = '';
    else throw new LlmError('BAD_RESPONSE', 'response message had no text content');
  }
  return { text, finishReason };
}

class Semaphore {
  constructor(n) { this.n = n; this.waiters = []; }

  async acquire() {
    if (this.n > 0) { this.n--; return; }
    await new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next(); else this.n++;
  }
}

class OpenAICompatClient {
  constructor({
    env = process.env, fetchImpl = globalThis.fetch, baseUrl = ROUTER_BASE_URL, budget = null, catalog = null,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random,
    requestTimeoutMs = 120_000, maxRetries = MAX_RETRIES, maxRetryAfterMs = MAX_RETRY_AFTER_MS, maxConcurrent = 4,
    extraBody = {}, callLog = null, onEvent = null, maxOutputTokensCeiling = MAX_OUTPUT_TOKENS_CEILING, maxCallUsd = MAX_CALL_USD,
  } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.baseUrl = checkBaseUrl(baseUrl);
    this.budget = budget || new RouterBudget({ env, dir: path.join(warrantHome(env), 'router'), fetchCredits: () => fetchCredits({ env, fetchImpl, baseUrl: this.baseUrl }) });
    this.catalog = catalog || new RouterCatalog({ env, fetchImpl, baseUrl: this.baseUrl });
    this.sleep = sleep;
    this.random = random;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxRetries = maxRetries;
    this.maxRetryAfterMs = maxRetryAfterMs;
    this.extraBody = extraBody; // per model id: extra top-level request fields (e.g. a reasoning-effort switch); never auth
    this.callLog = callLog === null ? path.join(this.budget.dir || path.join(warrantHome(env), 'router'), 'calls.jsonl') : callLog;
    this.onEvent = onEvent; // ({ type, model, attempt, ms, status?, message? }); never receives the key
    this.gate = new Semaphore(maxConcurrent);
    this.maxOutputTokensCeiling = maxOutputTokensCeiling;
    this.maxCallUsd = maxCallUsd;
    this.httpCalls = 0;
  }

  _emit(event) {
    if (this.onEvent) { try { this.onEvent(event); } catch (_error) { /* diagnostics must never break a call */ } }
  }

  _logCall(entry) {
    if (!this.callLog) return;
    try {
      fs.mkdirSync(path.dirname(this.callLog), { recursive: true });
      fs.appendFileSync(this.callLog, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    } catch (_error) { /* the call journal is an audit aid; the ledger is the control */ }
  }

  async _body(request) {
    const supported = await this.catalog.supportedParameters(request.model);
    const messages = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    for (const m of request.messages) messages.push({ role: m.role, content: m.content });
    const body = { model: request.model, messages, stream: false };
    // The router's supported_parameters list is incomplete (it names only tools), so max_tokens and temperature are the default; a
    // reasoning-style entry that names max_completion_tokens without max_tokens is sent that way and without a temperature.
    const limitName = supported.includes('max_completion_tokens') && !supported.includes('max_tokens') ? 'max_completion_tokens' : 'max_tokens';
    body[limitName] = request.maxOutputTokens;
    if (limitName === 'max_tokens' || supported.includes('temperature')) body.temperature = request.temperature;
    return { ...body, ...(Object.hasOwn(this.extraBody, request.model) ? this.extraBody[request.model] : {}) };
  }

  async generate(rawRequest, { signal } = {}) {
    const request = canonicalRequest(rawRequest);
    if (!Object.hasOwn(ALLOWED_MODELS, request.model)) throw new RouterModelError(`model ${request.model} is not in the router allowlist (${Object.keys(ALLOWED_MODELS).join(', ')})`, { model: request.model });
    if (this.env.WARRANT_LIVE !== '1') throw new LiveDisabledError();
    const price = await this.catalog.prices(request.model);
    const estimatedInput = estimateInputTokens(request);
    const worstCase = costUsd(price, { inputTokens: estimatedInput, outputTokens: request.maxOutputTokens });
    if (request.maxOutputTokens > this.maxOutputTokensCeiling) throw new LlmError('OUTPUT_LIMIT', `maxOutputTokens ${request.maxOutputTokens} is above the router ceiling of ${this.maxOutputTokensCeiling}`);
    if (worstCase > this.maxCallUsd) throw new LlmError('CALL_TOO_EXPENSIVE', `this call could cost up to ${worstCase.toFixed(6)} USD (about ${estimatedInput} input tokens, ${request.maxOutputTokens} output), over the per-call ceiling of ${this.maxCallUsd} USD; nothing was sent`);
    const body = JSON.stringify(await this._body(request));
    const keyHash = requestKey(request);
    let lastDetail = 'no attempt made';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal && signal.aborted) throw new LlmError('ABORTED', 'generate aborted');
      const reservation = await this.budget.reserve({ model: request.model, worstCaseUsd: worstCase });
      await this.gate.acquire();
      const startedAt = Date.now();
      // Read at the moment of the call, held in this local only.
      const key = loadRouterKey(this.env);
      const redact = (text) => redactRouter(text, key);
      let response;
      let text;
      try {
        try {
          const timeout = AbortSignal.timeout(this.requestTimeoutMs);
          this.httpCalls++;
          response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
            method: 'POST', redirect: 'error', body,
            headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
          text = await response.text();
          if (text.length > MAX_BODY_CHARS) throw new LlmError('BAD_RESPONSE', 'response body is implausibly large');
        } catch (error) {
          if (error instanceof LlmError) { await this.budget.chargeUnsettled(reservation, { reason: 'oversized' }); throw error; }
          const causeCode = error && error.cause && error.cause.code;
          if (NEVER_SENT.has(causeCode) || NEVER_SENT.has(error && error.code)) await this.budget.release(reservation);
          else await this.budget.chargeUnsettled(reservation, { reason: signal && signal.aborted ? 'aborted' : 'network' });
          if (signal && signal.aborted) throw new LlmError('ABORTED', 'generate aborted');
          lastDetail = `network error: ${redact(error && error.message ? error.message : String(error)).slice(0, 300)}`;
          this._emit({ type: 'network_error', model: request.model, attempt, ms: Date.now() - startedAt, message: lastDetail.slice(0, 200) });
          if (attempt === this.maxRetries) throw new LlmError('NETWORK', lastDetail);
          await this.sleep(this._backoff(attempt, null));
          continue;
        }
      } finally {
        this.gate.release();
      }

      const ms = Date.now() - startedAt;
      if (!response.ok) {
        await this.budget.release(reservation); // an error status is not billed; the periodic /credits reconciliation would show it if it were
        const message = redact(this._errorMessage(text)).slice(0, 300);
        lastDetail = `HTTP ${response.status}: ${message}`;
        this._emit({ type: 'http_error', model: request.model, attempt, ms, status: response.status, message: message.slice(0, 200) });
        if (response.status === 402 || (response.status === 429 && /insufficient|credit|balance|quota/i.test(message))) {
          throw new BudgetExhaustedError(`the router reports no credit left (${lastDetail})`, { status: response.status });
        }
        if (response.status === 429 || response.status >= 500 || response.status === 408) {
          if (attempt === this.maxRetries) throw new LlmError(response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', lastDetail, { status: response.status });
          await this.sleep(this._backoff(attempt, parseRetryAfter(response.headers.get('retry-after'))));
          continue;
        }
        throw new LlmError('HTTP_ERROR', lastDetail, { status: response.status });
      }

      return this._finish({ response, text, request, reservation, price, estimatedInput, worstCase, keyHash, ms, attempt, redact });
    }
    throw new LlmError('EXHAUSTED_RETRIES', lastDetail);
  }

  // A 200 reply: charge it (whatever is wrong with it), then validate it.
  async _finish({ response, text, request, reservation, price, estimatedInput, worstCase, keyHash, ms, attempt, redact }) {
    let json = null;
    try { json = JSON.parse(text); } catch (_error) { json = null; }
    const usage = readUsage(json);
    // No usable usage: charge the worst case this call could have cost and say so. Never assume zero.
    const effective = usage || { inputTokens: estimatedInput, outputTokens: request.maxOutputTokens, cachedTokens: 0, reasoningTokens: 0 };
    const cost = usage ? Math.max(costUsd(price, effective), usage.reportedCostUsd || 0) : worstCase;
    await this.budget.settle(reservation, cost, { model: request.model });
    const served = json && typeof json.model === 'string' ? json.model : null;
    const requestId = this._requestId(response, json, redact);
    const logBase = { model: request.model, servedModel: served === null ? null : redact(served).slice(0, 80), requestId, key: keyHash.slice(0, 16), attempt, ms, costUsd: cost, usageEstimated: !usage, reportedCostUsd: usage ? usage.reportedCostUsd : null, usage: { inputTokens: effective.inputTokens, outputTokens: effective.outputTokens }, reasoningTokens: effective.reasoningTokens };

    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      this._logCall({ ...logBase, outcome: 'bad_json' });
      throw new LlmError('BAD_RESPONSE', 'response was not a JSON object (truncated or invalid); it was charged at the worst case');
    }
    if (served === null || !servedModelMatches(request.model, served)) {
      this._logCall({ ...logBase, outcome: 'model_mismatch' });
      throw new ModelMismatchError(request.model, served === null ? null : redact(served).slice(0, 80), cost);
    }
    if (usage && effective.outputTokens > request.maxOutputTokens * OVERRUN_FACTOR + OVERRUN_SLACK_TOKENS) {
      this._logCall({ ...logBase, outcome: 'output_overrun' });
      throw new BudgetExhaustedError(`${request.model} was billed for ${effective.outputTokens} output tokens against a limit of ${request.maxOutputTokens}; it does not honour max_tokens, so the run stops (the call was charged ${cost.toFixed(6)} USD)`, { model: request.model, costUsd: cost });
    }
    let choice;
    try { choice = readChoice(json); } catch (error) {
      this._logCall({ ...logBase, outcome: 'bad_choice' });
      throw error;
    }
    this._logCall({ ...logBase, outcome: 'ok', finishReason: choice.finishReason });
    this._emit({ type: 'ok', model: request.model, attempt, ms, costUsd: cost });
    return {
      text: choice.text,
      usage: { inputTokens: effective.inputTokens, outputTokens: effective.outputTokens },
      finishReason: choice.finishReason,
      costUsd: cost,
      servedModel: served,
      requestId,
      usageEstimated: !usage,
      reasoningTokens: effective.reasoningTokens,
      reportedCostUsd: usage ? usage.reportedCostUsd : null,
      latencyMs: ms,
    };
  }

  _requestId(response, json, redact) {
    const candidates = [];
    for (const h of REQUEST_ID_HEADERS) candidates.push(response.headers.get(h));
    candidates.push(json && typeof json === 'object' && typeof json.id === 'string' ? json.id : null);
    const found = candidates.find((c) => typeof c === 'string' && c.trim());
    // eslint-disable-next-line no-control-regex
    return found ? redact(found.replace(/[^\x20-\x7e]/g, '')).slice(0, 100) : null;
  }

  // Provider error bodies are {error:{message,code,type}} or {message}; anything else is shown truncated.
  _errorMessage(bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText); } catch (_error) { /* not JSON */ }
    if (parsed && parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') return parsed.error.message;
    if (parsed && typeof parsed.error === 'string') return parsed.error;
    if (parsed && typeof parsed.message === 'string') return parsed.message;
    return String(bodyText).slice(0, 300);
  }

  // Exponential backoff with jitter, capped; a server Retry-After is a floor for the wait but is itself capped.
  _backoff(attempt, retryAfterMs) {
    const exp = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    const jittered = exp / 2 + this.random() * (exp / 2);
    if (retryAfterMs === null || retryAfterMs === undefined) return jittered;
    return Math.min(this.maxRetryAfterMs, Math.max(retryAfterMs, 0)) + Math.floor(this.random() * 250);
  }
}

module.exports = Object.freeze({ ModelMismatchError, OpenAICompatClient, parseRetryAfter, readChoice, readUsage });
