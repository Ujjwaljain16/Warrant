'use strict';

// Offline tests for the third-party router adapter: src/llm/openai-compat.js, router-budget.js, router-models.js.
// A local node:http server (random port) plays the router. Nothing here reaches the internet, reads a real key, or touches the
// real ~/.warrant: every test gets its own temp home. The fake key is built at runtime, so no key-shaped literal exists in the repo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { CassetteClient, LiveDisabledError, LlmError, QuotaExhaustedError, requestKey } = require('../src/llm');
const { OpenAICompatClient, parseRetryAfter, readUsage } = require('../src/llm/openai-compat');
const {
  BudgetExhaustedError, BudgetLedgerError, RouterBudget, capFromEnv, fetchCredits, remainingFrom, serverSpendSince,
} = require('../src/llm/router-budget');
const {
  ALLOWED_MODELS, RouterCatalog, RouterModelError, builtinPrices, checkBaseUrl, costUsd, estimateInputTokens, estimatePlan, measuredProfile,
  isRouterAgentModel, isRouterModel, parseCatalog, redactRouter, routerGetJson, scheduledAgentModels, servedModelMatches, stageBudget, verifyCatalog,
} = require('../src/llm/router-models');

const FAKE_KEY = `crk_${'q9'.repeat(14)}x7`;
const MODEL = 'google/gemini-3.8-flash';
const REQ = { model: MODEL, system: 'be brief', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 512, temperature: 0 };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-router-${p}-`));

function homeWithKey(key = FAKE_KEY) {
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.warrant'), { recursive: true });
  if (key !== null) fs.writeFileSync(path.join(home, '.warrant', 'closerouter.key'), `${key}\n`);
  return home;
}
const envFor = (home, extra = {}) => ({ WARRANT_LIVE: '1', USERPROFILE: home, HOME: home, ...extra });

function catalogEntry(id, over = {}) {
  const fb = ALLOWED_MODELS[id];
  return {
    id, name: id, context_length: 100000, max_output_tokens: 16000,
    // The real router sends prices as decimal strings with 8 decimals; an override may still be a plain number or garbage.
    pricing: { prompt: fb.prompt.toFixed(8), completion: fb.completion.toFixed(8), cache_read: (fb.prompt / 10).toFixed(8), unit: 'usd_per_million_tokens', ...(over.pricing || {}) },
    supported_parameters: ['tool_choice', 'tools'], ...over, ...(over.pricing ? { pricing: { prompt: fb.prompt.toFixed(8), completion: fb.completion.toFixed(8), cache_read: (fb.prompt / 10).toFixed(8), unit: 'usd_per_million_tokens', ...over.pricing } } : {}),
  };
}

function okBody(over = {}) {
  return {
    id: 'req-abc123', model: 'google/gemini-3.8-flash', choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 200 }, ...over,
  };
}

// The mock router. `chat(n, body, req)` returns {status?, headers?, body?, raw?, delayMs?, hang?}; /models and /credits are state.
async function startMock({ chat = () => ({ body: okBody() }), models = null, credits = { total_credits: 0.9, total_usage: 0.1 }, modelsStatus = 200 } = {}) {
  const state = { chatCalls: 0, modelsCalls: 0, creditsCalls: 0, requests: [], credits: { ...credits }, models: models || Object.keys(ALLOWED_MODELS).map((id) => catalogEntry(id)) };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      state.requests.push({ method: req.method, url: req.url, headers: req.headers, raw });
      const send = (status, headers, text) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(text); };
      if (req.method === 'GET' && req.url === '/v1/models') { state.modelsCalls++; return send(modelsStatus, {}, JSON.stringify({ data: state.models })); }
      if (req.method === 'GET' && req.url === '/v1/credits') { state.creditsCalls++; return send(200, {}, JSON.stringify({ data: state.credits })); }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const n = state.chatCalls++;
        let body = null;
        try { body = JSON.parse(raw); } catch (_error) { /* leave null */ }
        const r = await chat(n, body, req, state);
        if (r.hang) return undefined;
        if (r.delayMs) await new Promise((resolve) => setTimeout(resolve, r.delayMs));
        return send(r.status || 200, r.headers || {}, r.raw !== undefined ? r.raw : JSON.stringify(r.body));
      }
      return send(404, {}, '{"error":{"message":"not found"}}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return { baseUrl, state, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

// A client wired to a temp home and the mock, with virtual sleeping.
function makeClient(mock, { home = homeWithKey(), clientOpts = {}, budgetOpts = {}, envExtra = {}, creditsFetch = null } = {}) {
  const env = envFor(home, envExtra);
  const sleeps = [];
  const events = [];
  const budget = new RouterBudget({
    env, fetchCredits: creditsFetch || (() => fetchCredits({ env, baseUrl: mock.baseUrl })), ...budgetOpts,
  });
  const client = new OpenAICompatClient({
    env, baseUrl: mock.baseUrl, budget, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, onEvent: (e) => events.push(e), ...clientOpts,
  });
  return { client, budget, sleeps, events, env, home, ledgerDir: path.join(home, '.warrant', 'router') };
}

const allFilesText = (dir) => {
  let out = '';
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name !== 'closerouter.key') out += `\n${f}\n${fs.readFileSync(f, 'utf8')}`; } };
  walk(dir);
  return out;
};

// ------------------------------------------------------------------ the happy path and the request on the wire

test('a call returns text, usage, cost and the served model, and settles the ledger with the reported usage', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client, budget } = makeClient(mock);
  const out = await client.generate(REQ);
  assert.equal(out.text, 'hello');
  assert.deepEqual(out.usage, { inputTokens: 1000, outputTokens: 200 });
  assert.equal(out.finishReason, 'stop');
  assert.equal(out.servedModel, 'google/gemini-3.8-flash');
  assert.equal(out.requestId, 'req-abc123');
  assert.equal(out.usageEstimated, false);
  const expected = (1000 * 0.03 + 200 * 0.15) / 1e6;
  assert.ok(Math.abs(out.costUsd - expected) < 1e-12, `cost ${out.costUsd} vs ${expected}`);
  const status = budget.status();
  assert.ok(Math.abs(status.spentUsd - expected) < 1e-12);
  assert.equal(status.reservedUsd, 0);
  assert.equal(status.calls, 1);
});

test('the request: bearer key in a header only, system message first, stream off, token limit and temperature, no key in URL or body', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client } = makeClient(mock);
  await client.generate({ ...REQ, maxOutputTokens: 300, temperature: 0.4 });
  const post = mock.state.requests.find((r) => r.method === 'POST');
  assert.equal(post.url, '/v1/chat/completions');
  assert.equal(post.headers.authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(post.raw);
  assert.deepEqual(body, { model: MODEL, messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }], stream: false, max_tokens: 300, temperature: 0.4 });
  for (const r of mock.state.requests) { assert.ok(!r.url.includes(FAKE_KEY)); assert.ok(!r.raw.includes(FAKE_KEY)); }
});

test('reasoning-style models: max_completion_tokens and no temperature when /models says so; extraBody is merged', async (t) => {
  const id = 'openai/gpt-5.4-mini';
  const mock = await startMock({ models: [catalogEntry(id, { supported_parameters: ['max_completion_tokens', 'reasoning'] }), ...['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'].map((m) => catalogEntry(m))], chat: () => ({ body: okBody({ model: id }) }) });
  t.after(mock.close);
  const { client } = makeClient(mock, { clientOpts: { extraBody: { [id]: { reasoning_effort: 'minimal' } } } });
  await client.generate({ ...REQ, model: id });
  const body = JSON.parse(mock.state.requests.find((r) => r.method === 'POST').raw);
  assert.equal(body.max_completion_tokens, 512);
  assert.ok(!('max_tokens' in body) && !('temperature' in body));
  assert.equal(body.reasoning_effort, 'minimal');
});

test('content given as an array of text parts is joined; unknown finish reasons map to other', async (t) => {
  const mock = await startMock({ chat: () => ({ body: okBody({ choices: [{ message: { content: [{ type: 'text', text: 'ab' }, { type: 'text', text: 'cd' }] }, finish_reason: 'tool_calls' }] }) }) });
  t.after(mock.close);
  const out = await makeClient(mock).client.generate(REQ);
  assert.equal(out.text, 'abcd');
  assert.equal(out.finishReason, 'other');
});

// ------------------------------------------------------------------ gating and allowlist

test('no live call without WARRANT_LIVE=1: not generate, not /models, not /credits; nothing reaches the server', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const home = homeWithKey();
  const env = { USERPROFILE: home, HOME: home };
  const client = new OpenAICompatClient({ env, baseUrl: mock.baseUrl });
  await assert.rejects(client.generate(REQ), LiveDisabledError);
  await assert.rejects(routerGetJson('/models', { env, baseUrl: mock.baseUrl }), LiveDisabledError);
  await assert.rejects(fetchCredits({ env, baseUrl: mock.baseUrl }), LiveDisabledError);
  assert.equal(mock.state.requests.length, 0);
});

test('models outside the allowlist are refused before anything is sent', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client } = makeClient(mock);
  await assert.rejects(client.generate({ ...REQ, model: 'openai/gpt-5.4' }), RouterModelError);
  assert.equal(mock.state.requests.length, 0);
});

test('a missing or malformed key file is a clear error that does not echo anything secret', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const missing = makeClient(mock, { home: homeWithKey(null) });
  await assert.rejects(missing.client.generate(REQ), (e) => e.code === 'NO_API_KEY' && /closerouter\.key/.test(e.message));
  const spaced = makeClient(mock, { home: homeWithKey('two words') });
  await assert.rejects(spaced.client.generate(REQ), (e) => e.code === 'NO_API_KEY' && !e.message.includes('two words'));
});

test('the key is only sent over https, or plain http to localhost; no credentials or queries in the base URL', () => {
  assert.equal(checkBaseUrl('https://api.closerouter.dev/v1/'), 'https://api.closerouter.dev/v1');
  assert.equal(checkBaseUrl('http://127.0.0.1:9/v1'), 'http://127.0.0.1:9/v1');
  for (const bad of ['http://api.closerouter.dev/v1', 'ftp://x/v1', 'https://user:pw@x/v1', 'https://x/v1?key=1', 'not a url']) assert.throws(() => checkBaseUrl(bad), (e) => e.code === 'BAD_BASE_URL', bad);
});

// ------------------------------------------------------------------ identity

test('served model: the requested id, or the same name without provider prefix, is accepted; anything else is rejected', () => {
  assert.ok(servedModelMatches(MODEL, MODEL));
  assert.ok(servedModelMatches(MODEL, 'gemini-3.8-flash'));
  assert.ok(servedModelMatches(MODEL, 'Google/Gemini-3.8-Flash'));
  for (const bad of ['google/gemini-3.8-flash-lite', 'gemini-3.8-flash-2026', 'anthropic/claude-haiku-5.5', '', null, undefined, 42, 'gemini-3.8-flash/evil']) assert.ok(!servedModelMatches(MODEL, bad), String(bad));
});

test('a reply from a different model fails closed: error, charged, journalled, and a cassette records nothing', async (t) => {
  const mock = await startMock({ chat: () => ({ body: okBody({ model: 'some-cheap/other-model' }) }) });
  t.after(mock.close);
  const { client, budget, ledgerDir } = makeClient(mock);
  const cassetteFile = path.join(tmp('cassette'), 'x.jsonl');
  const cassette = new CassetteClient({ file: cassetteFile, mode: 'record', storeRequest: false, inner: client });
  await assert.rejects(cassette.generate(REQ), (e) => e.code === 'MODEL_MISMATCH' && e.servedModel === 'some-cheap/other-model' && e instanceof QuotaExhaustedError && e.message.includes("some-cheap/other-model"));
  assert.ok(!fs.existsSync(cassetteFile), 'a mismatched reply must never be recorded');
  assert.ok(budget.status().spentUsd > 0, 'the router still billed it');
  const journal = fs.readFileSync(path.join(ledgerDir, 'calls.jsonl'), 'utf8');
  assert.match(journal, /"outcome":"model_mismatch"/);
  assert.match(journal, /some-cheap\/other-model/);
  await assert.rejects(makeClient(await startMock({ chat: () => ({ body: (() => { const b = okBody(); delete b.model; return b; })() }) }).then((m) => { t.after(m.close); return m; })).client.generate(REQ), (e) => e.code === 'MODEL_MISMATCH');
});

// ------------------------------------------------------------------ retries

test('429 with a huge Retry-After waits at most the cap, then succeeds', async (t) => {
  const mock = await startMock({ chat: (n) => (n === 0 ? { status: 429, headers: { 'retry-after': '999999' }, body: { error: { message: 'slow down' } } } : { body: okBody() }) });
  t.after(mock.close);
  const { client, sleeps } = makeClient(mock);
  const out = await client.generate(REQ);
  assert.equal(out.text, 'hello');
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] <= 60_000 + 250, `slept ${sleeps[0]} ms`);
  assert.ok(sleeps[0] >= 60_000);
  assert.equal(mock.state.chatCalls, 2);
});

test('persistent 429 gives RATE_LIMITED after the bounded number of retries and costs nothing', async (t) => {
  const mock = await startMock({ chat: () => ({ status: 429, headers: { 'retry-after': '1' }, body: { error: { message: 'busy' } } }) });
  t.after(mock.close);
  const { client, budget, sleeps } = makeClient(mock, { clientOpts: { maxRetries: 3 } });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'RATE_LIMITED' && e.status === 429);
  assert.equal(mock.state.chatCalls, 4);
  assert.equal(sleeps.length, 3);
  assert.equal(budget.status().spentUsd, 0);
  assert.equal(budget.status().reservedUsd, 0);
});

test('500s are retried with backoff; a 4xx is not retried', async (t) => {
  const mock = await startMock({ chat: (n) => (n < 2 ? { status: 500, body: { error: { message: 'boom' } } } : { body: okBody() }) });
  t.after(mock.close);
  const a = makeClient(mock);
  assert.equal((await a.client.generate(REQ)).text, 'hello');
  assert.equal(a.sleeps.length, 2);
  assert.ok(a.sleeps[1] > a.sleeps[0], 'exponential');

  const bad = await startMock({ chat: () => ({ status: 400, body: { error: { message: 'bad request' } } }) });
  t.after(bad.close);
  const b = makeClient(bad);
  await assert.rejects(b.client.generate(REQ), (e) => e.code === 'HTTP_ERROR' && e.status === 400);
  assert.equal(bad.state.chatCalls, 1);
});

test('402 and a 429 that says the credit is gone stop the run like an exhausted quota', async (t) => {
  for (const reply of [{ status: 402, body: { error: { message: 'payment required' } } }, { status: 429, body: { error: { message: 'insufficient credits' } } }]) {
    const mock = await startMock({ chat: () => reply });
    t.after(mock.close);
    const { client } = makeClient(mock);
    await assert.rejects(client.generate(REQ), (e) => e instanceof BudgetExhaustedError && e instanceof QuotaExhaustedError && e.code === 'BUDGET_EXHAUSTED');
    assert.equal(mock.state.chatCalls, 1);
  }
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('nonsense'), null);
  const ms = parseRetryAfter(new Date(Date.now() + 5000).toUTCString());
  assert.ok(ms > 3000 && ms <= 5000);
});

// ------------------------------------------------------------------ timeouts and slow replies

test('a slow reply times out, is retried a bounded number of times, and is charged at the worst case (it may have been billed)', async (t) => {
  const mock = await startMock({ chat: () => ({ delayMs: 600, body: okBody() }) });
  t.after(mock.close);
  const { client, budget } = makeClient(mock, { clientOpts: { requestTimeoutMs: 80, maxRetries: 1 } });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'NETWORK');
  assert.equal(mock.state.chatCalls, 2);
  const status = budget.status();
  assert.ok(status.spentUsd > 0 && status.unsettledUsd === status.spentUsd);
  assert.equal(status.reservedUsd, 0);
});

test('a refused connection never reached the router, so it is free; a slow-but-in-time reply works', async (t) => {
  const mock = await startMock({ chat: () => ({ delayMs: 120, body: okBody() }) });
  t.after(mock.close);
  const ok = makeClient(mock, { clientOpts: { requestTimeoutMs: 3000 } });
  assert.equal((await ok.client.generate(REQ)).text, 'hello');

  const dead = await startMock();
  const deadUrl = dead.baseUrl;
  await dead.close();
  const home = homeWithKey();
  const env = envFor(home);
  const budget = new RouterBudget({ env, fetchCredits: async () => ({ totalCredits: 0.9, totalUsage: 0.1 }) });
  const client = new OpenAICompatClient({ env, baseUrl: deadUrl, budget, sleep: async () => {}, random: () => 0.5, maxRetries: 1, catalog: { prices: async () => builtinPrices()[MODEL], supportedParameters: async () => [] } });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'NETWORK');
  assert.equal(budget.status().spentUsd, 0);
});

// ------------------------------------------------------------------ validation

test('truncated or invalid JSON is a clear error, charged at the worst case, and not retried', async (t) => {
  const mock = await startMock({ chat: () => ({ raw: '{"id":"x","model":"google/gemini-3.8-flash","choices":[{"message":{"con' }) });
  t.after(mock.close);
  const { client, budget } = makeClient(mock);
  await assert.rejects(client.generate(REQ), (e) => e instanceof LlmError && e.code === 'BAD_RESPONSE' && !(e instanceof TypeError));
  assert.equal(mock.state.chatCalls, 1);
  assert.ok(budget.status().spentUsd > 0);
});

test('any malformed body yields an LlmError, never a TypeError', async (t) => {
  const bodies = ['null', '[]', '42', '"text"', '{}', '{"model":"google/gemini-3.8-flash"}', '{"model":"google/gemini-3.8-flash","choices":[]}',
    '{"model":"google/gemini-3.8-flash","choices":[null]}', '{"model":"google/gemini-3.8-flash","choices":"x"}', '{"model":"google/gemini-3.8-flash","choices":[{}]}',
    '{"model":"google/gemini-3.8-flash","choices":[{"message":null}]}', '{"model":"google/gemini-3.8-flash","choices":[{"message":{}}]}',
    '{"model":"google/gemini-3.8-flash","choices":[{"message":{"content":42}}]}', '{"model":"google/gemini-3.8-flash","choices":[{"message":{"content":null},"finish_reason":"stop"}]}',
    '{"model":7,"choices":[{"message":{"content":"x"}}],"usage":[]}', '{"model":"google/gemini-3.8-flash","choices":[{"message":{"content":"x"}}],"usage":{"prompt_tokens":"a","completion_tokens":-1}}'];
  const mock = await startMock({ chat: (n) => ({ raw: bodies[n] }) });
  t.after(mock.close);
  const { client } = makeClient(mock, { budgetOpts: { capUsd: 5 } });
  for (const [i, raw] of bodies.entries()) {
    try { await client.generate(REQ); } catch (error) {
      assert.ok(error instanceof LlmError, `body ${i} ${raw} threw ${error && error.name}: ${error && error.message}`);
      continue;
    }
    // Only the last body (usage garbage but valid text) is allowed to succeed.
    assert.equal(i, bodies.length - 1, `body ${i} ${raw} should have been rejected`);
  }
});

test('missing usage: cost is estimated at the worst case and flagged, never zero', async (t) => {
  const body = okBody();
  delete body.usage;
  const mock = await startMock({ chat: () => ({ body }) });
  t.after(mock.close);
  const { client, budget } = makeClient(mock);
  const out = await client.generate(REQ);
  assert.equal(out.usageEstimated, true);
  assert.equal(out.usage.outputTokens, REQ.maxOutputTokens);
  assert.ok(out.usage.inputTokens > 0 && out.costUsd > 0);
  assert.ok(Math.abs(budget.status().spentUsd - out.costUsd) < 1e-12);
});

test('reasoning tokens: cost follows the reported usage; extra reasoning tokens are added when they are clearly not included; empty content with length is valid', async (t) => {
  assert.deepEqual(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 400 } } }), { inputTokens: 10, outputTokens: 500, cachedTokens: 0, reasoningTokens: 400, reportedCostUsd: null });
  assert.equal(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 400 } } }).outputTokens, 420);
  assert.equal(readUsage({ usage: { prompt_tokens: 10 } }), null);
  assert.equal(readUsage(null), null);

  const replies = [
    okBody({ usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 450 } } }),
    okBody({ choices: [{ message: { content: null, reasoning: 'thinking...' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 64, completion_tokens_details: { reasoning_tokens: 64 } } }),
  ];
  const mock = await startMock({ chat: (n) => ({ body: replies[n] }) });
  t.after(mock.close);
  const { client } = makeClient(mock);
  const a = await client.generate(REQ);
  assert.equal(a.reasoningTokens, 450);
  assert.equal(a.usage.outputTokens, 500);
  assert.ok(Math.abs(a.costUsd - (100 * 0.03 + 500 * 0.15) / 1e6) < 1e-12);
  const b = await client.generate({ ...REQ, messages: [{ role: 'user', content: 'again' }] });
  assert.equal(b.text, '');
  assert.equal(b.finishReason, 'length');
  assert.equal(b.reasoningTokens, 64);
});

test('the router-reported usage.cost is used when it is higher than the price table says, and ignored when lower', async (t) => {
  const replies = [okBody({ usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.001 } }), okBody({ usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 1e-9 } })];
  const mock = await startMock({ chat: (n) => ({ body: replies[n] }) });
  t.after(mock.close);
  const { client } = makeClient(mock);
  const high = await client.generate(REQ);
  assert.equal(high.costUsd, 0.001);
  assert.equal(high.reportedCostUsd, 0.001);
  const low = await client.generate({ ...REQ, messages: [{ role: 'user', content: 'again' }] });
  assert.ok(Math.abs(low.costUsd - (1000 * 0.03 + 200 * 0.15) / 1e6) < 1e-12);
});

// ------------------------------------------------------------------ /models, prices, /credits

test('/models is fetched once and cached on disk without any secret; verification refuses a price that rose more than 3x', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const home = homeWithKey();
  const env = envFor(home);
  const a = new RouterCatalog({ env, baseUrl: mock.baseUrl });
  assert.ok((await a.verify()).ok);
  await a.load();
  const b = new RouterCatalog({ env, baseUrl: mock.baseUrl });
  assert.ok((await b.verify()).ok);
  assert.equal(mock.state.modelsCalls, 1, 'second catalogue instance must use the disk cache');
  assert.ok(!allFilesText(path.join(home, '.warrant')).includes(FAKE_KEY));

  const jump = [catalogEntry(MODEL, { pricing: { completion: ALLOWED_MODELS[MODEL].completion * 3.5 } })];
  const v = verifyCatalog(parseCatalog({ data: jump }), [MODEL]);
  assert.ok(!v.ok);
  assert.match(v.problems[0].problem, /rose more than 3x/);
  const ok3 = verifyCatalog(parseCatalog({ data: [catalogEntry(MODEL, { pricing: { completion: ALLOWED_MODELS[MODEL].completion * 2.9 } })] }), [MODEL]);
  assert.ok(ok3.ok);
  assert.ok(Math.abs(ok3.prices[MODEL].completion - ALLOWED_MODELS[MODEL].completion * 2.9) < 1e-12);
});

test('a price drop is not trusted below the built-in table; missing models, wrong units and unparseable prices refuse', () => {
  const fb = ALLOWED_MODELS[MODEL];
  const cheap = verifyCatalog(parseCatalog({ data: [catalogEntry(MODEL, { pricing: { prompt: 0, completion: 0 } })] }), [MODEL]);
  assert.ok(cheap.ok);
  assert.equal(cheap.prices[MODEL].prompt, fb.prompt);
  assert.equal(cheap.prices[MODEL].completion, fb.completion);
  assert.ok(!verifyCatalog(parseCatalog({ data: [] }), [MODEL]).ok);
  assert.ok(!verifyCatalog(parseCatalog({ data: [catalogEntry(MODEL, { pricing: { unit: 'usd_per_token' } })] }), [MODEL]).ok);
  assert.ok(!verifyCatalog(parseCatalog({ data: [catalogEntry(MODEL, { pricing: { prompt: 'cheap' } })] }), [MODEL]).ok);
  assert.ok(!verifyCatalog(parseCatalog({ data: [catalogEntry(MODEL)] }), ['openai/gpt-5.4']).ok);
  assert.throws(() => parseCatalog({}), (e) => e.code === 'BAD_RESPONSE');
});

test('a price jump on the live router stops the call before anything is sent', async (t) => {
  const models = Object.keys(ALLOWED_MODELS).map((id) => catalogEntry(id, id === MODEL ? { pricing: { prompt: 1 } } : {}));
  const mock = await startMock({ models });
  t.after(mock.close);
  const { client } = makeClient(mock);
  await assert.rejects(client.generate(REQ), (e) => e instanceof RouterModelError && /rose more than 3x/.test(e.message));
  assert.equal(mock.state.chatCalls, 0);
});

test('/credits: strict parsing and the three readings of the balance', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const env = envFor(homeWithKey());
  assert.deepEqual(await fetchCredits({ env, baseUrl: mock.baseUrl }), { totalCredits: 0.9, totalUsage: 0.1 });
  mock.state.credits = { total_credits: 'lots' };
  await assert.rejects(fetchCredits({ env, baseUrl: mock.baseUrl }), (e) => e.code === 'BAD_RESPONSE');
  const c = { totalCredits: 0.89698193, totalUsage: 0.10301807 };
  assert.equal(remainingFrom(c, 'remaining'), 0.89698193);
  assert.ok(Math.abs(remainingFrom(c, 'purchased_minus_usage') - 0.79396386) < 1e-9);
  assert.equal(remainingFrom(c, 'min'), remainingFrom(c, 'purchased_minus_usage'));
  const later = { totalCredits: 0.89, totalUsage: 0.11 };
  assert.ok(Math.abs(serverSpendSince(c, later, 'remaining') - 0.00698193) < 1e-9);
  assert.ok(Math.abs(serverSpendSince(c, later, 'purchased_minus_usage') - 0.00698193) < 1e-9);
  assert.ok(serverSpendSince(c, c, 'min') === 0);
});

// ------------------------------------------------------------------ the budget

const stubCredits = (remaining, usage = 0.1) => async () => ({ totalCredits: remaining, totalUsage: usage });

test('the cap is hard: calls are refused before the ledger could exceed it, with a QuotaExhausted-compatible error', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client, budget } = makeClient(mock, { budgetOpts: { capUsd: 0.0003, semantics: 'remaining' } });
  let done = 0;
  let refused = null;
  for (let i = 0; i < 20; i++) {
    try { await client.generate({ ...REQ, messages: [{ role: 'user', content: `q${i}` }] }); done++; } catch (error) { refused = error; break; }
  }
  assert.ok(refused instanceof BudgetExhaustedError && refused instanceof QuotaExhaustedError, String(refused));
  assert.equal(refused.code, 'BUDGET_EXHAUSTED');
  assert.ok(done >= 1);
  const spent = budget.status().spentUsd;
  assert.ok(spent <= 0.0003, `spent ${spent}`);
  assert.equal(mock.state.chatCalls, done, 'a refused call is never sent');
});

test('the pre-flight worst case uses the full output limit at the completion price and a conservative input estimate', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client, budget } = makeClient(mock, { budgetOpts: { capUsd: 0.0001, semantics: 'remaining' } });
  // 64 output tokens cost 9.6e-6 and the input estimate for this prompt is >2000 tokens (6e-5): together just under the cap, so
  // one call is allowed; a request limit of 8192 output tokens (1.2e-3) can never fit.
  await assert.rejects(client.generate({ ...REQ, maxOutputTokens: 8192 }), BudgetExhaustedError);
  assert.equal(mock.state.chatCalls, 0);
  assert.equal(budget.status().spentUsd, 0);
  const long = 'x'.repeat(5000);
  const tokens = estimateInputTokens({ system: '', messages: [{ role: 'user', content: long }] });
  assert.ok(tokens >= 5000 / 2.5 && tokens > 1250, 'at least 1.6x the usual 4 characters per token');
  await client.generate({ ...REQ });
});

test('the cap never exceeds the live balance minus the reserve, whatever WARRANT_LIVE cap is configured', async (t) => {
  const budget = new RouterBudget({ env: envFor(homeWithKey()), capUsd: 5, fetchCredits: stubCredits(0.5), semantics: 'remaining' });
  const s = await budget.refreshBalance();
  assert.ok(Math.abs(s.effectiveCapUsd - 0.3) < 1e-9, `effective cap ${s.effectiveCapUsd}`);
  await assert.rejects(budget.reserve({ model: MODEL, worstCaseUsd: 0.31 }), BudgetExhaustedError);
  const r = await budget.reserve({ model: MODEL, worstCaseUsd: 0.29 });
  await assert.rejects(budget.reserve({ model: MODEL, worstCaseUsd: 0.02 }), BudgetExhaustedError, 'in-flight reservations count');
  await budget.settle(r, 0.1);
  assert.ok(Math.abs(budget.status().balanceEstimateUsd - 0.4) < 1e-9);
  // Unverified readings take the smaller balance: 0.5 credits - 0.4 usage = 0.1 left, below the reserve -> nothing may be spent.
  const careful = new RouterBudget({ env: envFor(homeWithKey()), capUsd: 5, fetchCredits: stubCredits(0.5, 0.4), semantics: 'min' });
  assert.equal((await careful.refreshBalance()).effectiveCapUsd, 0);
  await assert.rejects(careful.reserve({ model: MODEL, worstCaseUsd: 0.0001 }), BudgetExhaustedError);
});

test('the default cap is $0.40 and WARRANT_ROUTER_CAP_USD is validated', () => {
  assert.equal(capFromEnv({}), 0.4);
  assert.equal(capFromEnv({ WARRANT_ROUTER_CAP_USD: '0.25' }), 0.25);
  for (const bad of ['abc', '-1', '0', 'Infinity', '0x']) assert.throws(() => capFromEnv({ WARRANT_ROUTER_CAP_USD: bad }), BudgetLedgerError, bad);
});

test('an unreadable /credits fails closed when there is no earlier reading, and is tolerated for a while when there is one', async (t) => {
  const dir = tmp('credits');
  const fail = async () => { throw new LlmError('NETWORK', 'down'); };
  let clock = 1_000_000;
  const b = new RouterBudget({ dir, env: envFor(homeWithKey()), fetchCredits: fail, now: () => clock });
  await assert.rejects(b.reserve({ model: MODEL, worstCaseUsd: 0.001 }), BudgetLedgerError);
  const ok = new RouterBudget({ dir, env: envFor(homeWithKey()), fetchCredits: stubCredits(0.9), semantics: 'remaining', now: () => clock });
  await ok.refreshBalance();
  const later = new RouterBudget({ dir, env: envFor(homeWithKey()), fetchCredits: fail, semantics: 'remaining', now: () => clock, refreshMs: 1000 });
  clock += 5000;
  await later.reserve({ model: MODEL, worstCaseUsd: 0.001 });
  clock += 2 * 3600_000;
  await assert.rejects(later.reserve({ model: MODEL, worstCaseUsd: 0.001 }), BudgetLedgerError);
});

test('reconciliation: a server-side charge the ledger cannot explain is adopted with a warning; an agreeing server raises none', async () => {
  const dir = tmp('recon');
  const env = envFor(homeWithKey());
  let credits = { totalCredits: 0.9, totalUsage: 0.1 };
  const warnings = [];
  const b = new RouterBudget({ dir, env, fetchCredits: async () => credits, semantics: 'remaining', onWarning: (m) => warnings.push(m) });
  await b.refreshBalance({ force: true });
  const r = await b.reserve({ model: MODEL, worstCaseUsd: 0.01 });
  await b.settle(r, 0.005);
  credits = { totalCredits: 0.895, totalUsage: 0.105 };
  await b.refreshBalance({ force: true });
  assert.equal(warnings.length, 0, 'ledger 0.005 vs server 0.005 agree');
  credits = { totalCredits: 0.86, totalUsage: 0.14 };
  await b.refreshBalance({ force: true });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /disagree by more than 20%/);
  assert.ok(Math.abs(b.status().spentUsd - 0.04) < 1e-9, `ledger raised to the server figure: ${b.status().spentUsd}`);
  // the opposite: the server reports less than the ledger holds -> warn, keep the higher ledger
  const dir2 = tmp('recon2');
  let c2 = { totalCredits: 0.9, totalUsage: 0.1 };
  const w2 = [];
  const b2 = new RouterBudget({ dir: dir2, env, fetchCredits: async () => c2, semantics: 'remaining', onWarning: (m) => w2.push(m) });
  await b2.refreshBalance({ force: true });
  await b2.settle(await b2.reserve({ model: MODEL, worstCaseUsd: 0.02 }), 0.02);
  c2 = { totalCredits: 0.89, totalUsage: 0.11 };
  await b2.refreshBalance({ force: true });
  assert.equal(w2.length, 1);
  assert.ok(Math.abs(b2.status().spentUsd - 0.02) < 1e-9);
});

test('a reservation that is never settled is charged at its worst case when it expires', async () => {
  const dir = tmp('expire');
  let clock = 5_000_000;
  const env = envFor(homeWithKey());
  const b = new RouterBudget({ dir, env, fetchCredits: stubCredits(0.9), semantics: 'remaining', now: () => clock, reservationTtlMs: 60_000 });
  await b.reserve({ model: MODEL, worstCaseUsd: 0.004 });
  assert.equal(b.status().reservedUsd, 0.004);
  clock += 120_000;
  await b.reserve({ model: MODEL, worstCaseUsd: 0.001 });
  const s = b.status();
  assert.ok(Math.abs(s.spentUsd - 0.004) < 1e-9 && Math.abs(s.unsettledUsd - 0.004) < 1e-9);
  assert.ok(s.warnings.length >= 1);
});

// ------------------------------------------------------------------ the ledger under lock contention and corruption

test('several processes sharing one ledger can never push it over the cap', async () => {
  const dir = tmp('multi');
  const home = homeWithKey();
  const worker = `
    const { RouterBudget } = require(${JSON.stringify(require.resolve('../src/llm/router-budget'))});
    (async () => {
      const [dir, home, n, worst, actual] = process.argv.slice(1);
      const env = { WARRANT_LIVE: '1', USERPROFILE: home, HOME: home };
      const b = new RouterBudget({ dir, env, capUsd: 0.05, semantics: 'remaining', fetchCredits: async () => ({ totalCredits: 100, totalUsage: 0 }), refreshCalls: 1e9 });
      let ok = 0; let refused = 0;
      for (let i = 0; i < Number(n); i++) {
        try { const r = await b.reserve({ model: 'm', worstCaseUsd: Number(worst) }); await b.settle(r, Number(actual)); ok++; } catch (e) { if (e.code === 'BUDGET_EXHAUSTED') refused++; else throw e; }
      }
      process.stdout.write(JSON.stringify({ ok, refused }));
    })().catch((e) => { process.stderr.write(String(e && e.stack)); process.exit(1); });
  `;
  const runs = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', worker, dir, home, '40', '0.002', '0.001'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exited ${code}: ${err}`))));
  }));
  const results = await Promise.all(runs);
  const ok = results.reduce((s, r) => s + r.ok, 0);
  const b = new RouterBudget({ dir, env: envFor(home), capUsd: 0.05, semantics: 'remaining', fetchCredits: stubCredits(100) });
  const s = b.status();
  assert.ok(s.spentUsd <= 0.05 + 1e-9, `spent ${s.spentUsd} exceeds the cap`);
  assert.ok(Math.abs(s.spentUsd - ok * 0.001) < 1e-9, `ledger ${s.spentUsd} vs ${ok} successful calls`);
  assert.equal(s.calls, ok);
  assert.equal(s.reservedUsd, 0);
  assert.ok(s.spentUsd >= 0.04, `the cap should actually have been approached (spent ${s.spentUsd})`);
  assert.ok(results.some((r) => r.refused > 0), 'some calls must have been refused');
  assert.ok(!fs.existsSync(path.join(dir, 'ledger.lock')), 'lock released');
});

test('lock contention: a held lock times out cleanly; a stale lock left by a dead process is broken', async () => {
  const dir = tmp('lock');
  const env = envFor(homeWithKey());
  const mk = (extra = {}) => new RouterBudget({ dir, env, fetchCredits: stubCredits(0.9), semantics: 'remaining', ...extra });
  await mk().refreshBalance({ force: true });
  const lock = path.join(dir, 'ledger.lock');
  fs.writeFileSync(lock, 'someone-else');
  await assert.rejects(mk({ lockTimeoutMs: 150 }).reserve({ model: MODEL, worstCaseUsd: 0.001 }), (e) => e instanceof BudgetLedgerError && /lock/.test(e.message));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'someone-else', 'a live lock is never deleted by its waiter');
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  const r = await mk({ lockTimeoutMs: 2000 }).reserve({ model: MODEL, worstCaseUsd: 0.001 });
  assert.ok(r.id);
});

test('a corrupted, edited, truncated or half-deleted ledger fails closed, and no call is sent', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const bad = {
    garbage: (f) => fs.writeFileSync(f, '{not json'),
    truncated: (f) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').slice(0, 40)),
    edited: (f) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"spentUsd":[0-9.e-]+/, '"spentUsd":0')),
    wrongShape: (f) => fs.writeFileSync(f, JSON.stringify({ version: 1, spentUsd: 'a' })),
    empty: (f) => fs.writeFileSync(f, ''),
    deleted: (f) => fs.unlinkSync(f),
  };
  for (const [name, corrupt] of Object.entries(bad)) {
    const { client, ledgerDir, budget } = makeClient(mock);
    await client.generate({ ...REQ, messages: [{ role: 'user', content: `seed ${name}` }] }); // creates a ledger with real spend and a spend.log
    const before = mock.state.chatCalls;
    corrupt(path.join(ledgerDir, 'ledger.json'));
    await assert.rejects(client.generate({ ...REQ, messages: [{ role: 'user', content: `after ${name}` }] }), (e) => e instanceof BudgetLedgerError && e instanceof QuotaExhaustedError && e.code === 'BUDGET_LEDGER', name);
    assert.throws(() => budget.status(), BudgetLedgerError, name);
    assert.equal(mock.state.chatCalls, before, `${name}: nothing may be sent once the ledger is untrusted`);
  }
});

// ------------------------------------------------------------------ secrets

test('the key never appears in errors, events, the call journal, the ledger, the cache or a cassette, even when the server echoes it', async (t) => {
  const masked = `${FAKE_KEY.slice(0, 8)}...${FAKE_KEY.slice(-8)}`;
  const replies = [
    { status: 401, body: { error: { message: `Incorrect API key provided: ${FAKE_KEY}` } } },
    { status: 400, body: { error: { message: `bad header Authorization: Bearer ${FAKE_KEY} and ${masked}` } } },
    { status: 500, raw: `upstream said: ${encodeURIComponent(FAKE_KEY)} ${JSON.stringify(FAKE_KEY)}` },
    { raw: `{"model":"google/gemini-3.8-flash","note":"${FAKE_KEY}","choices":[{"message":{"content":"x` },
    { body: okBody({ model: `evil-${FAKE_KEY}` }) },
    { body: okBody({ id: `id-${FAKE_KEY}` }) },
  ];
  const mock = await startMock({ chat: (n) => replies[n] });
  t.after(mock.close);
  const { client, events, home } = makeClient(mock, { clientOpts: { maxRetries: 0 } });
  const cassetteFile = path.join(home, 'cassette.jsonl');
  const cassette = new CassetteClient({ file: cassetteFile, mode: 'record', storeRequest: false, inner: client });
  const seen = [];
  for (let i = 0; i < replies.length; i++) {
    try { const out = await cassette.generate({ ...REQ, messages: [{ role: 'user', content: `q${i}` }] }); seen.push(JSON.stringify(out)); } catch (error) {
      seen.push(`${error.name} ${error.code} ${error.message} ${JSON.stringify(Object.fromEntries(Object.entries(error)))} ${error.stack}`);
    }
  }
  const blob = [...seen, JSON.stringify(events), allFilesText(path.join(home, '.warrant')), fs.existsSync(cassetteFile) ? fs.readFileSync(cassetteFile, 'utf8') : ''].join('\n');
  for (const secret of [FAKE_KEY, encodeURIComponent(FAKE_KEY), FAKE_KEY.slice(0, 8), FAKE_KEY.slice(-8)]) assert.ok(!blob.includes(secret), `leaked ${secret.slice(0, 4)}...`);
  assert.equal(redactRouter(`x Bearer ${FAKE_KEY} y`, FAKE_KEY).includes(FAKE_KEY), false);
  assert.ok(seen.length === replies.length);
});

test('a network failure message carrying the key is redacted', async () => {
  const home = homeWithKey();
  const env = envFor(home);
  const budget = new RouterBudget({ env, fetchCredits: stubCredits(0.9), semantics: 'remaining' });
  const fetchImpl = async () => { throw new Error(`connect failed for https://x/?k=${FAKE_KEY} ${FAKE_KEY}`); };
  const client = new OpenAICompatClient({ env, fetchImpl, budget, sleep: async () => {}, maxRetries: 0, catalog: { prices: async () => builtinPrices()[MODEL], supportedParameters: async () => [] } });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'NETWORK' && !e.message.includes(FAKE_KEY) && !e.message.includes(FAKE_KEY.slice(0, 8)));
});

// ------------------------------------------------------------------ cassettes

test('cassette compatibility: record then replay, key from the router model id, no auth in the file, replay makes no HTTP call and costs nothing', async (t) => {
  const mock = await startMock();
  t.after(mock.close);
  const { client, budget, home } = makeClient(mock);
  const file = path.join(home, 'run.jsonl');
  const rec = new CassetteClient({ file, mode: 'replay-then-live', storeRequest: false, inner: client });
  const first = await rec.generate(REQ);
  const spent = budget.status().spentUsd;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].key, requestKey(REQ));
  assert.equal(lines[0].model, MODEL);
  // The cassette keeps text/usage/finishReason; with the optional provenance patch (docs/ROUTER.md) it also keeps servedModel/requestId/costUsd.
  const keys = Object.keys(lines[0].response);
  for (const k of ['finishReason', 'text', 'usage']) assert.ok(keys.includes(k), k);
  for (const k of keys) assert.ok(['finishReason', 'text', 'usage', 'servedModel', 'requestId', 'costUsd'].includes(k), `unexpected cassette field ${k}`);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!/authorization|bearer|api[-_ ]?key|crk_/i.test(raw));
  assert.notEqual(requestKey({ ...REQ, model: 'anthropic/claude-haiku-5.5' }), requestKey(REQ), 'the router model id is part of the key');

  const replay = new CassetteClient({ file, mode: 'replay', storeRequest: false });
  const again = await replay.generate(REQ);
  assert.equal(again.text, first.text);
  assert.deepEqual(again.usage, first.usage);
  assert.equal(mock.state.chatCalls, 1);
  assert.equal(budget.status().spentUsd, spent);
});

// ------------------------------------------------------------------ concurrency inside one process

test('parallel calls in one process share the ledger correctly', async (t) => {
  const mock = await startMock({ chat: () => ({ delayMs: 20, body: okBody() }) });
  t.after(mock.close);
  const { client, budget } = makeClient(mock, { clientOpts: { maxConcurrent: 3 } });
  const outs = await Promise.all(Array.from({ length: 12 }, (_, i) => client.generate({ ...REQ, messages: [{ role: 'user', content: `p${i}` }] })));
  assert.equal(outs.length, 12);
  const s = budget.status();
  assert.equal(s.calls, 12);
  assert.equal(s.reservedUsd, 0);
  assert.ok(Math.abs(s.spentUsd - 12 * outs[0].costUsd) < 1e-9);
});

// ------------------------------------------------------------------ the estimator

test('cost arithmetic, the dry-run estimator and the measured profile', () => {
  const price = builtinPrices()['anthropic/claude-haiku-5.5'];
  assert.ok(Math.abs(costUsd(price, { inputTokens: 1_000_000, outputTokens: 1_000_000 }) - (0.0359 + 0.1793)) < 1e-9);
  assert.ok(Math.abs(costUsd({ prompt: 1, completion: 2, cacheRead: 0.1 }, { inputTokens: 1_000_000, cachedTokens: 500_000, outputTokens: 0 }) - 0.55) < 1e-9);
  const plan = estimatePlan([{ model: MODEL, runs: 90, callsPerRun: 10, inputTokensPerCall: 5000, outputTokensPerCall: 400 }]);
  assert.equal(plan.calls, 900);
  assert.ok(Math.abs(plan.usd - (900 * 5000 * 0.03 + 900 * 400 * 0.15) / 1e6) < 1e-9);
  assert.throws(() => estimatePlan([{ model: 'x/y', runs: 1, callsPerRun: 1, inputTokensPerCall: 1, outputTokensPerCall: 1 }]), RouterModelError);
  const p = measuredProfile([{ usage: { calls: 2, inputTokens: 1000, outputTokens: 100 } }, { usage: { calls: 4, inputTokens: 5000, outputTokens: 300 } }, { usage: { calls: 0 } }]);
  assert.equal(p.runs, 2);
  assert.equal(p.callsPerRun, 3);
  assert.equal(p.inputTokensPerRun, 3000);
  assert.equal(p.worstRun.inputTokens, 5000);
  assert.equal(measuredProfile([]), null);
});

test('stage budget: scheduled agents only, final plus dev runs, judge on every run, hidden reasoning and a token margin', () => {
  const agentRecords = [
    { claim: 'done', usage: { calls: 10, inputTokens: 20000, outputTokens: 1000 } },
    { claim: 'cannot', usage: { calls: 6, inputTokens: 10000, outputTokens: 500 } },
  ];
  const judgeRecords = [{ usage: { calls: 1, inputTokens: 700, outputTokens: 60 } }, { usage: { calls: 1, inputTokens: 900, outputTokens: 80 } }];
  const plan = stageBudget({ agentRecords, judgeRecords, runs: 90, devRuns: 5, inflate: 2 });
  assert.equal(plan.profile.callsPerRun, 8);
  assert.deepEqual(plan.rows.map((r) => r.model), ['anthropic/claude-haiku-5.5', 'openai/gpt-5.4-mini'], 'the optional gemini model and the judge are not scheduled agents');
  assert.deepEqual(scheduledAgentModels(), plan.rows.map((r) => r.model));
  assert.equal(ALLOWED_MODELS[MODEL].scheduled, false);
  assert.ok(isRouterModel(MODEL) && isRouterAgentModel(MODEL) && !isRouterAgentModel('deepseek/deepseek-v4.1-flash'));
  const haiku = plan.rows[0];
  const expectedAgent = (15000 * 2 * 0.0359 + (750 * 2) * 0.1793) / 1e6;
  assert.ok(Math.abs(haiku.agentPerRun - expectedAgent) < 1e-9);
  assert.ok(Math.abs(plan.judge.perRun - (800 * 3 * 2 * 0.0081 + 70 * 3 * 2 * 0.0323) / 1e6) < 1e-9, 'judge runs all three variants on every run');
  assert.ok(Math.abs(haiku.finalTotal - haiku.perRun * 90) < 1e-12 && Math.abs(haiku.devTotal - haiku.perRun * 5) < 1e-12 && Math.abs(haiku.total - haiku.perRun * 95) < 1e-12);
  const gpt = plan.rows[1];
  assert.ok(Math.abs(gpt.outputTokensPerRun - (750 * 2 + 8 * ALLOWED_MODELS['openai/gpt-5.4-mini'].hiddenOutputPerCall)) < 1e-9);
  assert.ok(Math.abs(plan.total - (haiku.total + gpt.total)) < 1e-12);
  assert.equal(stageBudget({ agentRecords, runs: 90, inflate: 1, models: [MODEL] }).rows[0].outputTokensPerRun, 750 + 8 * 100, 'the optional model can still be priced on request');
  assert.throws(() => stageBudget({ agentRecords: [] }), RouterModelError);
});

test('per-call ceilings: output limit, worst-case dollars and a model that ignores its output limit', async (t) => {
  const mock = await startMock({ chat: (n) => (n === 0 ? { body: okBody({ usage: { prompt_tokens: 100, completion_tokens: 5000 } }) } : { body: okBody() }) });
  t.after(mock.close);
  const { client, budget } = makeClient(mock);
  await assert.rejects(client.generate({ ...REQ, maxOutputTokens: 8193 }), (e) => e.code === 'OUTPUT_LIMIT');
  assert.equal(mock.state.chatCalls, 0);
  // The loop's 8192-token limit on the dearest scheduled model stays far below the per-call ceiling.
  const dearest = costUsd(builtinPrices()['anthropic/claude-haiku-5.5'], { inputTokens: 100_000, outputTokens: 8192 });
  assert.ok(dearest < 0.01, `worst case ${dearest}`);
  // A prompt so large that one call could cost over a cent is refused before it is sent.
  await assert.rejects(client.generate({ ...REQ, messages: [{ role: 'user', content: 'x'.repeat(3_000_000) }] }), (e) => e.code === 'CALL_TOO_EXPENSIVE');
  assert.equal(mock.state.chatCalls, 0);
  // Billed for 5000 output tokens against a limit of 64: charged, journalled, and the run stops.
  await assert.rejects(client.generate(REQ), (e) => e instanceof BudgetExhaustedError && /does not honour max_tokens/.test(e.message));
  assert.ok(budget.status().spentUsd > 0);
  assert.match(fs.readFileSync(path.join(path.dirname(budget.file), 'calls.jsonl'), 'utf8'), /"outcome":"output_overrun"/);
  assert.equal((await client.generate({ ...REQ, messages: [{ role: 'user', content: 'next' }] })).text, 'hello', 'an honest reply still works afterwards');
});

// ------------------------------------------------------------------ wiring in the runner and the cassette

test('runner wiring: --router plans the two scheduled agents and the router judge with a cost against the cap, and refuses unscheduled ids', async () => {
  const run = require('../src/bench/agent-run');
  const root = tmp('runner');
  const lines = [];
  const { exitCode } = await run.runBench({ stage: 'dev', router: true, dryRun: true, root, out: (l) => lines.push(l), env: {} });
  assert.equal(exitCode, 0);
  const text = lines.join('\n');
  for (const m of ['anthropic/claude-haiku-5.5', 'openai/gpt-5.4-mini', 'deepseek/deepseek-v4.1-flash']) assert.ok(text.includes(m), m);
  assert.ok(!text.includes('google/gemini-3.8-flash'), 'the optional model is not scheduled');
  assert.match(text, /hard cap \(margin|0\.40 USD hard cap/);
  assert.deepEqual(fs.readdirSync(root), [], 'a dry run creates no files');
  assert.deepEqual([...run.PROTOCOL.router_models], ['anthropic/claude-haiku-5.5', 'openai/gpt-5.4-mini']);
  for (const router of run.PROTOCOL.router_models) assert.equal(run.PROTOCOL.judges[router], 'deepseek/deepseek-v4.1-flash');
  await assert.rejects(run.runBench({ stage: 'dev', dryRun: true, root, models: ['deepseek/deepseek-v4.1-flash'], out: () => {}, env: {} }), /not in the protocol/);
  await assert.rejects(run.runBench({ stage: 'dev', dryRun: true, root, models: ['openai/gpt-5.4'], out: () => {}, env: {} }), /not in the protocol/);
  const optional = [];
  await run.runBench({ stage: 'dev', dryRun: true, root, models: ['google/gemini-3.8-flash'], out: (l) => optional.push(l), env: {} });
  assert.ok(optional.join('\n').includes('google/gemini-3.8-flash (router)'), 'the optional model can still be named explicitly');
});

test('cassette provenance: a router reply keeps servedModel, requestId and costUsd and replays them; other clients are unchanged', async () => {
  const file = path.join(tmp('prov'), 'p.jsonl');
  const inner = { generate: async () => ({ text: 'a', usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop', servedModel: MODEL, requestId: 'req-1', costUsd: 1e-6, secret: 'never stored' }) };
  const rec = new CassetteClient({ file, mode: 'record', storeRequest: false, inner });
  const first = await rec.generate(REQ);
  assert.equal(first.servedModel, MODEL);
  const line = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.deepEqual(line.response, { text: 'a', usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop', servedModel: MODEL, requestId: 'req-1', costUsd: 1e-6 });
  const replayed = await new CassetteClient({ file, mode: 'replay', storeRequest: false }).generate(REQ);
  assert.deepEqual(replayed, first);

  const plain = path.join(tmp('prov'), 'q.jsonl');
  await new CassetteClient({ file: plain, mode: 'record', storeRequest: false, inner: { generate: async () => ({ text: 'b', usage: { inputTokens: 2, outputTokens: 3 }, finishReason: 'stop' }) } }).generate(REQ);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(plain, 'utf8').trim()).response).sort(), ['finishReason', 'text', 'usage']);
});
