'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LiveDisabledError, LlmError } = require('./errors');
const { warrantHome } = require('./quota');
const { redactSecrets } = require('./secrets');

// Third-party OpenAI-compatible router (CloseRouter): the model allowlist, the price table, start-up verification and the
// dry-run cost estimator. Nothing here sends a prompt; the only network use is GET /models and GET /credits, which are
// gated by WARRANT_LIVE=1 like every other live call and carry the key in a header only.
//
// The router is a third party: the model behind an id cannot be verified (the prices are 10-40x below the vendors' list
// prices), so every id the benchmark may use is listed here explicitly, and src/llm/openai-compat.js refuses a response
// that names a different model.
const ROUTER_BASE_URL = 'https://api.closerouter.dev/v1';
const PRICE_UNIT = 'usd_per_million_tokens';
const PRICE_JUMP_FACTOR = 3;
// Default hard cap on total router spend for the whole project, in USD (the budget also never goes above balance minus its reserve).
const DEFAULT_CAP_USD = 0.40;
const CATALOG_TTL_MS = 6 * 3600 * 1000;

// Built-in fallback prices ($ per million tokens) from the router's own /models listing; cached input is priced as normal input.
// `role` is where the protocol uses the model; `scheduled: false` marks an OPTIONAL model that stays in the allowlist but is not part of the
// plan (Gemini is covered by the free direct key). `hiddenOutputPerCall` is the reasoning output observed per trivial call in the live
// check (docs/ROUTER.md); the router bills it as output. `servedAs` lists the only other spellings the router may report in the
// response's `model` field for that id (documented provider-prefix differences, nothing else).
const ALLOWED_MODELS = Object.freeze({
  'google/gemini-3.8-flash': Object.freeze({ role: 'agent', scheduled: false, prompt: 0.03, completion: 0.15, hiddenOutputPerCall: 100, servedAs: Object.freeze(['gemini-3.8-flash']) }),
  'anthropic/claude-haiku-5.5': Object.freeze({ role: 'agent', scheduled: true, prompt: 0.0359, completion: 0.1793, hiddenOutputPerCall: 0, servedAs: Object.freeze(['claude-haiku-5.5']) }),
  'openai/gpt-5.4-mini': Object.freeze({ role: 'agent', scheduled: true, prompt: 0.0225, completion: 0.135, hiddenOutputPerCall: 20, servedAs: Object.freeze(['gpt-5.4-mini']) }),
  'deepseek/deepseek-v4.1-flash': Object.freeze({ role: 'judge', scheduled: true, prompt: 0.0081, completion: 0.0323, hiddenOutputPerCall: 0, servedAs: Object.freeze(['deepseek-v4.1-flash']) }),
});

class RouterModelError extends LlmError {
  constructor(message, extra = {}) {
    super('ROUTER_MODEL', message, extra);
    this.name = 'RouterModelError';
  }
}

// The models the protocol schedules as agents (optional, unscheduled ones are excluded).
function scheduledAgentModels() {
  return Object.keys(ALLOWED_MODELS).filter((m) => ALLOWED_MODELS[m].role === 'agent' && ALLOWED_MODELS[m].scheduled);
}

function isRouterAgentModel(model) {
  return isRouterModel(model) && ALLOWED_MODELS[model].role === 'agent';
}

function isRouterModel(model) {
  return typeof model === 'string' && Object.hasOwn(ALLOWED_MODELS, model);
}

// True when the model id has the router's `provider/name` shape (the benchmark's direct Gemini ids never contain a slash).
function looksLikeRouterModel(model) {
  return typeof model === 'string' && model.includes('/');
}

// Response model names are compared after lower-casing; a response is accepted when it names the requested id, or the same
// name without the provider prefix, or one of the listed `servedAs` spellings. Nothing else (no dated suffixes, no other model).
function servedModelMatches(requested, served) {
  if (typeof served !== 'string' || !served) return false;
  const want = requested.toLowerCase();
  const got = served.toLowerCase();
  if (got === want) return true;
  const entry = Object.hasOwn(ALLOWED_MODELS, requested) ? ALLOWED_MODELS[requested] : null;
  const bare = want.includes('/') ? want.slice(want.indexOf('/') + 1) : want;
  if (got === bare) return true;
  return Boolean(entry && entry.servedAs.some((s) => s.toLowerCase() === got));
}

// ---------------------------------------------------------------- key and HTTP (shared with the budget and the client)

function keyFilePath(env = process.env) {
  return path.join(warrantHome(env), 'closerouter.key');
}

// The key is read from its one file at the moment of each call and is never stored on an object. It is not read from the
// environment on purpose: an environment variable would be inherited by every child process.
function loadRouterKey(env = process.env) {
  const file = keyFilePath(env);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { throw new LlmError('NO_API_KEY', `no router API key: put the key in ${file}`); }
  const key = text.trim();
  if (!key || /\s/.test(key)) throw new LlmError('NO_API_KEY', `the router key file ${file} is empty or malformed`);
  return key;
}

// Removes the key (whole, URL-encoded, JSON-escaped, and its first/last 8 characters, which providers echo in masked form) and
// bearer tokens from any text before it can reach an error, log or file.
function redactRouter(text, key) {
  const known = [];
  if (key) {
    known.push(key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1));
    // Masked echoes ('abcd...wxyz') are caught too, but only for fragments that look random: a purely alphabetic fragment is a word
    // (the real key starts with the provider name) and removing it would only mangle ordinary text.
    if (key.length >= 16) for (const part of [key.slice(0, 8), key.slice(-8)]) if (/[^A-Za-z]/.test(part)) known.push(part);
  }
  return redactSecrets(String(text), known).replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[REDACTED]');
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// The key is only ever sent over https, or over plain http to the local machine (the test mock).
function checkBaseUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch (_error) { throw new LlmError('BAD_BASE_URL', 'router base URL is not a valid URL'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new LlmError('BAD_BASE_URL', 'router base URL must be https (http only for localhost)');
  }
  if (url.username || url.password || url.search || url.hash) throw new LlmError('BAD_BASE_URL', 'router base URL must not carry credentials, a query or a fragment');
  return baseUrl.replace(/\/+$/, '');
}

// GET {base}{route} with the bearer key; resolves to the parsed JSON body. Requires WARRANT_LIVE=1.
async function routerGetJson(route, { env = process.env, fetchImpl = globalThis.fetch, baseUrl = ROUTER_BASE_URL, timeoutMs = 30_000, signal } = {}) {
  if (env.WARRANT_LIVE !== '1') throw new LiveDisabledError();
  const base = checkBaseUrl(baseUrl);
  const key = loadRouterKey(env);
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  let text;
  try {
    response = await fetchImpl(`${base}${route}`, {
      method: 'GET', headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    text = await response.text();
  } catch (error) {
    throw new LlmError('NETWORK', `GET ${route} failed: ${redactRouter(error && error.message ? error.message : String(error), key).slice(0, 300)}`);
  }
  if (!response.ok) throw new LlmError('HTTP_ERROR', `GET ${route} -> HTTP ${response.status}: ${redactRouter(text, key).slice(0, 300)}`, { status: response.status });
  try { return JSON.parse(text); } catch (_error) { throw new LlmError('BAD_RESPONSE', `GET ${route} did not return JSON`); }
}

// ---------------------------------------------------------------- catalog

// The router sends prices as decimal strings ("0.03000000"); plain numbers are accepted too. Anything else is not a price.
function toPrice(v) {
  const n = typeof v === 'string' && /^\d{1,6}(\.\d{1,12})?$/.test(v.trim()) ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

// GET /models -> Map(id -> {id, contextLength, maxOutputTokens, prompt, completion, cacheRead, unit, supportedParameters}).
// Entries that are not objects with a string id are ignored; price fields that are not finite numbers become null (so the
// verification fails closed instead of treating an unparseable price as free).
function parseCatalog(json) {
  if (!json || !Array.isArray(json.data)) throw new LlmError('BAD_RESPONSE', 'GET /models: response has no data array');
  const catalog = new Map();
  for (const m of json.data) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') continue;
    const p = m.pricing && typeof m.pricing === 'object' ? m.pricing : {};
    catalog.set(m.id, {
      id: m.id,
      contextLength: Number.isFinite(m.context_length) ? m.context_length : null,
      maxOutputTokens: Number.isFinite(m.max_output_tokens) ? m.max_output_tokens : null,
      prompt: toPrice(p.prompt),
      completion: toPrice(p.completion),
      cacheRead: toPrice(p.cache_read),
      unit: typeof p.unit === 'string' ? p.unit : null,
      supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.filter((s) => typeof s === 'string') : [],
    });
  }
  return catalog;
}

// Checks every id in `models` against the built-in table. Returns { ok, problems: [{model, problem}], prices } where prices
// is the effective price per model: the higher of the live and the built-in value for each field, so a price that dropped is
// never trusted below the table and a price that rose by more than 3x refuses the model.
function verifyCatalog(catalog, models = Object.keys(ALLOWED_MODELS)) {
  const problems = [];
  const prices = {};
  for (const id of models) {
    if (!isRouterModel(id)) { problems.push({ model: id, problem: 'not in the router allowlist' }); continue; }
    const fb = ALLOWED_MODELS[id];
    const live = catalog.get(id);
    if (!live) { problems.push({ model: id, problem: 'not listed by GET /models' }); continue; }
    if (live.unit !== PRICE_UNIT) { problems.push({ model: id, problem: `price unit is ${live.unit === null ? 'missing' : `"${live.unit}"`}, expected ${PRICE_UNIT}` }); continue; }
    if (live.prompt === null || live.completion === null) { problems.push({ model: id, problem: 'prompt/completion price missing or not a number' }); continue; }
    if (live.prompt > fb.prompt * PRICE_JUMP_FACTOR || live.completion > fb.completion * PRICE_JUMP_FACTOR) {
      problems.push({ model: id, problem: `price rose more than ${PRICE_JUMP_FACTOR}x (live ${live.prompt}/${live.completion}, expected ${fb.prompt}/${fb.completion} $/M in/out)` });
      continue;
    }
    const prompt = Math.max(live.prompt, fb.prompt);
    const completion = Math.max(live.completion, fb.completion);
    // Cached input is priced as ordinary input (the built-in table has no cache price), the most conservative reading.
    prices[id] = { prompt, completion, cacheRead: prompt };
  }
  return { ok: problems.length === 0, problems, prices };
}

function builtinPrices(models = Object.keys(ALLOWED_MODELS)) {
  const out = {};
  for (const id of models) out[id] = { prompt: ALLOWED_MODELS[id].prompt, completion: ALLOWED_MODELS[id].completion, cacheRead: ALLOWED_MODELS[id].prompt };
  return out;
}

/**
 * The live catalogue, fetched once and cached on disk (no secrets in it). `prices(model)` is the verified effective price and
 * throws RouterModelError when the model is unlisted, unpriced or more than 3x dearer than expected.
 */
class RouterCatalog {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, baseUrl = ROUTER_BASE_URL, cacheFile = null, ttlMs = CATALOG_TTL_MS, now = Date.now, timeoutMs = 30_000 } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.cacheFile = cacheFile || path.join(warrantHome(env), 'router', 'models-cache.json');
    this.ttlMs = ttlMs;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.catalog = null;
    this.fetchedAt = null;
    this.loading = null;
  }

  _readCache() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.data) || this.now() - parsed.fetchedAt > this.ttlMs || parsed.fetchedAt > this.now() + 60_000) return null;
      return { fetchedAt: parsed.fetchedAt, catalog: parseCatalog({ data: parsed.data }) };
    } catch (_error) { return null; }
  }

  _writeCache(json) {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      // Only the fields the catalogue needs are kept; nothing from the request (no headers, no key) is ever written.
      const data = json.data.filter((m) => m && typeof m.id === 'string').map((m) => ({
        id: m.id, context_length: m.context_length, max_output_tokens: m.max_output_tokens, pricing: m.pricing, supported_parameters: m.supported_parameters,
      }));
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: this.now(), data }));
      fs.renameSync(tmp, this.cacheFile);
    } catch (_error) { /* a cache that cannot be written only costs one more GET /models */ }
  }

  async load({ force = false } = {}) {
    if (this.catalog && !force) return this.catalog;
    if (this.loading && !force) return this.loading;
    this.loading = (async () => {
      if (!force) {
        const cached = this._readCache();
        if (cached) { this.catalog = cached.catalog; this.fetchedAt = cached.fetchedAt; return this.catalog; }
      }
      const json = await routerGetJson('/models', { env: this.env, fetchImpl: this.fetchImpl, baseUrl: this.baseUrl, timeoutMs: this.timeoutMs });
      const catalog = parseCatalog(json);
      this._writeCache(json);
      this.catalog = catalog;
      this.fetchedAt = this.now();
      return catalog;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }

  async verify(models) {
    return verifyCatalog(await this.load(), models);
  }

  // Effective price of one model, or RouterModelError.
  async prices(model) {
    const result = await this.verify([model]);
    if (!result.ok) throw new RouterModelError(`router model ${model} refused: ${result.problems.map((p) => p.problem).join('; ')}`, { model });
    return result.prices[model];
  }

  // Which parameters the router says the model accepts (empty when the listing does not say).
  async supportedParameters(model) {
    const entry = (await this.load()).get(model);
    return entry ? entry.supportedParameters : [];
  }
}

// ---------------------------------------------------------------- cost arithmetic and the dry-run estimator

// USD for one call: input at the prompt price (cached input at the cache_read price), output at the completion price.
function costUsd(price, usage) {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.cachedTokens) || 0));
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  const usd = ((input - cached) * price.prompt + cached * (price.cacheRead === undefined ? price.prompt : price.cacheRead) + output * price.completion) / 1e6;
  return Math.round(usd * 1e9) / 1e9;
}

// Conservative input-token estimate before a call: UTF-8 bytes / 2.5 (real text is 3.5-4.5 bytes per token) plus a per-message
// allowance. Only used for the pre-flight worst case and when a reply carries no usage.
function estimateInputTokens(request) {
  const bytes = Buffer.byteLength(request.system || '', 'utf8') + request.messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0);
  return Math.ceil(bytes / 2.5) + 16 + 8 * request.messages.length;
}

// Dry-run estimator. `profile` is {runs, callsPerRun, inputTokensPerCall, outputTokensPerCall} for one model's agent work and
// `judge` optionally {calls, inputTokensPerCall, outputTokensPerCall} for judge calls billed at the judge model's price.
function estimateModelCost(model, { runs, callsPerRun, inputTokensPerCall, outputTokensPerCall }, prices = builtinPrices()) {
  const price = prices[model];
  if (!price) throw new RouterModelError(`no price for ${model}`, { model });
  const calls = runs * callsPerRun;
  const inputTokens = Math.ceil(calls * inputTokensPerCall);
  const outputTokens = Math.ceil(calls * outputTokensPerCall);
  return { model, runs, calls, inputTokens, outputTokens, usd: costUsd(price, { inputTokens, outputTokens }) };
}

function estimatePlan(entries, prices = builtinPrices()) {
  const rows = entries.map((e) => estimateModelCost(e.model, e, prices));
  const usd = Math.round(rows.reduce((s, r) => s + r.usd, 0) * 1e9) / 1e9;
  return { rows, calls: rows.reduce((s, r) => s + r.calls, 0), inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0), outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0), usd };
}

// Token profile measured from a benchmark's runs.jsonl records (usage:{calls,inputTokens,outputTokens}); returns per-run means and the
// worst run, so cost per run can be priced for any model from another model's real episodes.
function measuredProfile(records) {
  const rows = records.filter((r) => r && r.usage && Number(r.usage.calls) > 0);
  if (rows.length === 0) return null;
  const n = rows.length;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const perCallIn = rows.map((r) => r.usage.inputTokens / r.usage.calls).sort((a, b) => a - b);
  return {
    runs: n,
    callsPerRun: sum((r) => r.usage.calls) / n,
    inputTokensPerRun: sum((r) => r.usage.inputTokens) / n,
    outputTokensPerRun: sum((r) => r.usage.outputTokens) / n,
    inputTokensPerCall: sum((r) => r.usage.inputTokens) / sum((r) => r.usage.calls),
    outputTokensPerCall: sum((r) => r.usage.outputTokens) / sum((r) => r.usage.calls),
    worstRun: rows.reduce((w, r) => (r.usage.inputTokens > w.usage.inputTokens ? r : w)).usage,
    medianInputTokensPerCall: perCallIn[Math.floor(perCallIn.length / 2)],
  };
}

// Stage budget: what the scheduled router agents' runs (final runs plus a minimal dev stage), plus the judge on EVERY run's output, would
// cost, priced from another model's measured episodes. `inflate` multiplies measured tokens (other tokenizers count more); each call
// also carries the model's hidden reasoning output. `runs`: final runs per model (30 tasks x repeats); `devRuns`: dev runs per model.
// `agentRecords`: runs.jsonl records; `judgeRecords`: judgments.jsonl records. The judge is assumed to run all three variants on every run.
function stageBudget({ agentRecords, judgeRecords = [], runs = 90, devRuns = 0, inflate = 1.5, prices = builtinPrices(), judgeModel = 'deepseek/deepseek-v4.1-flash', models = scheduledAgentModels() }) {
  const profile = measuredProfile(agentRecords);
  if (!profile) throw new RouterModelError('no measured runs to build a profile from');
  const claimDone = agentRecords.filter((r) => r.claim === 'done').length / agentRecords.length;
  const judged = judgeRecords.filter((j) => j && j.usage && Number(j.usage.calls) > 0);
  const judgeIn = judged.length ? judged.reduce((sum, j) => sum + j.usage.inputTokens, 0) / judged.length : 2500;
  const judgeOut = judged.length ? judged.reduce((sum, j) => sum + j.usage.outputTokens, 0) / judged.length : 200;
  const judgePerRun = costUsd(prices[judgeModel], { inputTokens: judgeIn * 3 * inflate, outputTokens: judgeOut * 3 * inflate });
  const rows = models.map((model) => {
    const inputTokens = profile.inputTokensPerRun * inflate;
    const outputTokens = profile.outputTokensPerRun * inflate + profile.callsPerRun * ALLOWED_MODELS[model].hiddenOutputPerCall;
    const agentPerRun = costUsd(prices[model], { inputTokens, outputTokens });
    const perRun = agentPerRun + judgePerRun;
    return { model, callsPerRun: profile.callsPerRun, inputTokensPerRun: inputTokens, outputTokensPerRun: outputTokens, agentPerRun, judgePerRun, perRun, finalTotal: perRun * runs, devTotal: perRun * devRuns, total: perRun * (runs + devRuns) };
  });
  return { runs, devRuns, inflate, profile, claimDone, judge: { model: judgeModel, inTokensPerCall: judgeIn, outTokensPerCall: judgeOut, perRun: judgePerRun }, rows, total: rows.reduce((sum, r) => sum + r.total, 0) };
}

module.exports = Object.freeze({
  ALLOWED_MODELS, CATALOG_TTL_MS, DEFAULT_CAP_USD, PRICE_JUMP_FACTOR, PRICE_UNIT, ROUTER_BASE_URL, RouterCatalog, RouterModelError,
  builtinPrices, checkBaseUrl, costUsd, estimateInputTokens, estimateModelCost, estimatePlan, isRouterModel, keyFilePath, loadRouterKey,
  isRouterAgentModel, looksLikeRouterModel, measuredProfile, scheduledAgentModels, parseCatalog, redactRouter, routerGetJson, servedModelMatches, stageBudget, verifyCatalog,
});

// node src/llm/router-models.js verify     (WARRANT_LIVE=1: GET /models, checks the four allowed models; spends nothing)
// node src/llm/router-models.js estimate [runs.jsonl] [judgments.jsonl] [--runs N] [--inflate X]   (offline)
if (require.main === module) {
  const write = (text) => process.stdout.write(`${text}\n`);
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : Number(argv.splice(i, 2)[1]); };
  const run = async () => {
    if (argv[0] === 'verify') {
      const result = await new RouterCatalog({}).verify();
      write(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    if (argv[0] === 'estimate') {
      const runs = flag('--runs', 90);
      const devRuns = flag('--dev-runs', 5);
      const inflate = flag('--inflate', 1.5);
      const cap = flag('--cap', DEFAULT_CAP_USD);
      const root = path.resolve(__dirname, '..', '..', 'results', 'agent-claims', 'dev');
      const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const input = { agentRecords: readJsonl(argv[1] || path.join(root, 'runs.jsonl')), judgeRecords: readJsonl(argv[2] || path.join(root, 'judgments.jsonl')), inflate };
      const show = (title, plan) => {
        write(title);
        for (const r of plan.rows) write("  " + r.model.padEnd(28) + " agent " + r.agentPerRun.toFixed(6) + " + judge " + r.judgePerRun.toFixed(6) + " = " + r.perRun.toFixed(6) + " USD/run; final " + plan.runs + " runs " + r.finalTotal.toFixed(4) + " + dev " + plan.devRuns + " runs " + r.devTotal.toFixed(4) + " = " + r.total.toFixed(4) + " USD");
        write("  projected total " + plan.total.toFixed(4) + " USD; margin under the " + cap.toFixed(2) + " cap " + (cap - plan.total).toFixed(4) + " USD (" + ((plan.total / cap) * 100).toFixed(0) + "% of the cap used)");
      };
      const plan = stageBudget({ ...input, runs, devRuns });
      write("profile from " + plan.profile.runs + " measured runs: " + plan.profile.callsPerRun.toFixed(2) + " calls, " + Math.round(plan.profile.inputTokensPerRun) + " in / " + Math.round(plan.profile.outputTokensPerRun) + " out tokens per run; x" + inflate + " token margin; judge on every run (3 variants)");
      show("plan: " + plan.rows.map((r) => r.model).join(' + '), plan);
      if (plan.total > 0.3) {
        const cut = stageBudget({ ...input, runs: Math.round((runs * 2) / 3), devRuns });
        show("over 0.30 USD: cut to repeats 2 (" + cut.runs + " final runs per model) saves " + (plan.total - cut.total).toFixed(4) + " USD", cut);
      }
      return 0;
    }
    write('usage: router-models.js verify | estimate [runs.jsonl] [judgments.jsonl] [--runs N] [--dev-runs N] [--inflate X] [--cap USD]');
    return 2;
  };
  run().then((code) => { process.exitCode = code; }, (error) => { write(`router-models: ${redactRouter(error && error.message ? error.message : String(error))}`); process.exitCode = 1; });
}
