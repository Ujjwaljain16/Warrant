'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CassetteClient, CassetteMissError, DailyCounter, FakeLlm, GeminiClient, LiveDisabledError, MissingKeyError, QuotaExhaustedError,
  RateLimiter, canonicalRequest, limitsFor, pacificDay, redactSecrets, requestKey, resolveModel,
} = require('../src/llm');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `warrant-llm-${p}-`));
// Built at runtime so no key-shaped literal sits in the repository; it is not a real key.
const FAKE_KEY = `AIza${'Sy'}${'k'.repeat(33)}`;
const REQ = { model: 'gemini-3.5-flash-lite', system: 'be brief', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 256, temperature: 0 };

function reply(body, { status = 200, headers = {} } = {}) {
  return () => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
}
const OK = { candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } };

// A client wired to temp state, a fake fetch, and virtual sleeping, so nothing here can touch the network or real quota.
function makeClient(fetchImpl, extra = {}) {
  const sleeps = [];
  const env = { WARRANT_LIVE: '1', GEMINI_API_KEY: FAKE_KEY, ...(extra.env || {}) };
  const counter = extra.counter || new DailyCounter({ dir: tmp('quota') });
  const client = new GeminiClient({
    env, fetchImpl, counter, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5,
    limiter: new RateLimiter({ now: () => 0, sleep: async () => {} }), ...(extra.client || {}),
  });
  return { client, sleeps, counter };
}

test('request keys cover the request content and ignore property order and extra fields', () => {
  const a = requestKey(REQ);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(requestKey({ temperature: 0, maxOutputTokens: 256, messages: [{ content: 'hi', role: 'user' }], system: 'be brief', model: REQ.model, headers: { 'x-goog-api-key': 'ignored' }, signal: 1 }), a);
  assert.notEqual(requestKey({ ...REQ, temperature: 0.5 }), a);
  assert.notEqual(requestKey({ ...REQ, system: 'be long' }), a);
  assert.notEqual(requestKey({ ...REQ, messages: [{ role: 'user', content: 'hi!' }] }), a);
  assert.throws(() => canonicalRequest({ ...REQ, messages: [] }), TypeError);
  assert.throws(() => canonicalRequest({ ...REQ, messages: [{ role: 'system', content: 'x' }] }), TypeError);
});

test('model table: free-tier limits and aliases', () => {
  assert.deepEqual(limitsFor('gemini-3.5-flash-lite'), { rpm: 15, tpm: 250_000, rpd: 500 });
  assert.deepEqual(limitsFor('gemma-4-31b'), { rpm: 30, tpm: 16_000, rpd: 14_400 });
  assert.equal(resolveModel('gemma-4-26b'), 'gemma-4-26b-a4b-it');
  assert.equal(limitsFor('gemini-3.8-flash').rpd, 20);
  assert.equal(limitsFor('some-unknown-model').rpd, 20, 'unknown models get the most conservative entry');
});

test('live calls are refused unless WARRANT_LIVE=1, before any key is read or request made', async () => {
  let called = 0;
  const { client } = makeClient(() => { called++; return reply(OK)(); }, { env: { WARRANT_LIVE: undefined } });
  await assert.rejects(client.generate(REQ), (e) => e instanceof LiveDisabledError && e.code === 'LIVE_DISABLED');
  assert.equal(called, 0);
});

test('missing key: a clear error naming the key file, never a request', async () => {
  const home = tmp('home');
  let called = 0;
  const { client } = makeClient(() => { called++; return reply(OK)(); }, { env: { GEMINI_API_KEY: undefined, USERPROFILE: home, HOME: home } });
  await assert.rejects(client.generate(REQ), (e) => e instanceof MissingKeyError && e.message.includes('gemini.key') && e.message.includes('GEMINI_API_KEY'));
  assert.equal(called, 0);
});

test('key file is used when the env var is absent; the key travels only in the x-goog-api-key header', async () => {
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.warrant'));
  fs.writeFileSync(path.join(home, '.warrant', 'gemini.key'), `${FAKE_KEY}\n`);
  let seen;
  const { client } = makeClient((url, init) => { seen = { url, init }; return reply(OK)(); }, { env: { GEMINI_API_KEY: undefined, USERPROFILE: home, HOME: home } });
  const out = await client.generate(REQ);
  assert.deepEqual(out, { text: 'hello', usage: { inputTokens: 7, outputTokens: 2 }, finishReason: 'stop' });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], FAKE_KEY);
  assert.ok(!seen.url.includes(FAKE_KEY) && !seen.init.body.includes(FAKE_KEY));
  assert.deepEqual(JSON.parse(seen.init.body), {
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    generationConfig: { maxOutputTokens: 256, temperature: 0 },
    systemInstruction: { parts: [{ text: 'be brief' }] },
  });
});

test('assistant turns map to role "model"; thought parts are dropped; MAX_TOKENS and blocked map to finish reasons', async () => {
  let body;
  const bodies = [
    { candidates: [{ content: { parts: [{ text: 'secret reasoning', thought: true }, { text: 'part1 ' }, { text: 'part2' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 6 } },
    { promptFeedback: { blockReason: 'SAFETY' } },
  ];
  const { client } = makeClient((url, init) => { body = JSON.parse(init.body); return reply(bodies.shift())(); });
  const first = await client.generate({ ...REQ, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(first, { text: 'part1 part2', usage: { inputTokens: 3, outputTokens: 10 }, finishReason: 'length' });
  const second = await client.generate(REQ);
  assert.equal(second.finishReason, 'blocked');
  assert.equal(second.text, '');
});

test('429 per-minute: retried, honouring Retry-After and the provider retryDelay', async () => {
  const responses = [
    reply({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'slow down' } }, { status: 429, headers: { 'retry-after': '3' } }),
    reply({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'slow down', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } }, { status: 429 }),
    reply(OK),
  ];
  const { client, sleeps } = makeClient(() => responses.shift()());
  const out = await client.generate(REQ);
  assert.equal(out.text, 'hello');
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 3000 && sleeps[0] < 3300, `waited at least Retry-After: ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 7000 && sleeps[1] < 7300, `waited at least retryDelay: ${sleeps[1]}`);
});

test('5xx: exponential backoff with jitter, then a clear error when retries run out', async () => {
  let calls = 0;
  const { client, sleeps } = makeClient(() => { calls++; return reply('upstream down', { status: 503 })(); }, { client: { maxRetries: 3 } });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'SERVER_ERROR' && e.status === 503);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [750, 1500, 3000], 'jitter pinned to 0.5: 0.75x of 1s, 2s, 4s');
});

test('4xx other than 408/429 is never retried', async () => {
  let calls = 0;
  const { client } = makeClient(() => { calls++; return reply({ error: { code: 400, message: 'bad request' } }, { status: 400 })(); });
  await assert.rejects(client.generate(REQ), (e) => e.code === 'HTTP_ERROR' && e.status === 400);
  assert.equal(calls, 1);
});

test('daily 429 raises QuotaExhaustedError, is remembered, and later calls do not even reach the network', async () => {
  let calls = 0;
  const daily = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
  const { client, counter } = makeClient(() => { calls++; return reply(daily, { status: 429 })(); });
  await assert.rejects(client.generate(REQ), (e) => e instanceof QuotaExhaustedError && e.code === 'QUOTA_EXHAUSTED' && e.model === 'gemini-3.5-flash-lite');
  assert.equal(calls, 1);
  assert.equal(counter.isExhausted('gemini-3.5-flash-lite'), true);
  await assert.rejects(client.generate(REQ), QuotaExhaustedError);
  assert.equal(calls, 1, 'second call refused locally');
  assert.equal(counter.isExhausted('gemma-4-31b-it'), false, 'other models are unaffected');
});

test('the local daily counter enforces the table limit and survives restarts', async () => {
  const dir = tmp('quota');
  const a = new DailyCounter({ dir });
  for (let i = 0; i < 20; i++) a.increment('gemini-3.8-flash');
  const b = new DailyCounter({ dir }); // a "restart": fresh object, same directory
  assert.equal(b.count('gemini-3.8-flash'), 20);
  assert.equal(b.remaining('gemini-3.8-flash'), 0);
  let calls = 0;
  const { client } = makeClient(() => { calls++; return reply(OK)(); }, { counter: b });
  await assert.rejects(client.generate({ ...REQ, model: 'gemini-3.8-flash' }), QuotaExhaustedError);
  assert.equal(calls, 0);
  assert.equal(b.remaining('gemini-3.5-flash-lite'), 500);
});

test('every HTTP request, including retries, is counted', async () => {
  const responses = [reply('x', { status: 500 }), reply(OK)];
  const { client, counter } = makeClient(() => responses.shift()());
  await client.generate(REQ);
  assert.equal(counter.count(REQ.model), 2);
  assert.equal(client.httpCalls, 2);
});

test('the quota day follows the US Pacific calendar and rolls over at Pacific midnight', () => {
  assert.equal(pacificDay(Date.parse('2026-07-01T06:59:59Z')), '2026-06-30'); // 23:59:59 PDT
  assert.equal(pacificDay(Date.parse('2026-07-01T07:00:00Z')), '2026-07-01'); // 00:00:00 PDT
  assert.equal(pacificDay(Date.parse('2026-12-01T07:59:59Z')), '2026-11-30'); // PST
  let now = Date.parse('2026-07-01T06:59:00Z');
  const counter = new DailyCounter({ dir: tmp('quota'), now: () => now });
  counter.markExhausted('gemini-3.5-flash-lite');
  assert.equal(counter.isExhausted('gemini-3.5-flash-lite'), true);
  now = Date.parse('2026-07-01T07:00:01Z');
  assert.equal(counter.isExhausted('gemini-3.5-flash-lite'), false, 'a new Pacific day starts with a fresh quota');
});

test('client call cap stops a scripted run regardless of quota', async () => {
  const { client } = makeClient(() => reply(OK)(), { client: { maxCalls: 2 } });
  await client.generate(REQ);
  await client.generate(REQ);
  await assert.rejects(client.generate(REQ), (e) => e.code === 'CALL_CAP');
});

test('errors and logs never carry the key', async () => {
  const leaky = () => Promise.reject(new Error(`connect failed for https://x/?key=${FAKE_KEY} header x-goog-api-key: ${FAKE_KEY}`));
  const { client } = makeClient(leaky, { client: { maxRetries: 0 } });
  await assert.rejects(client.generate(REQ), (e) => !e.message.includes(FAKE_KEY) && /REDACTED/.test(e.message));
  const text = redactSecrets(`Bearer abcdefghijklmnopqrstuv and ${FAKE_KEY} and key=${FAKE_KEY}&x=1`, [FAKE_KEY]);
  assert.ok(!text.includes(FAKE_KEY) && !text.includes('abcdefghijklmnopqrstuv'));
});

test('rate limiter: the 16th request in a minute waits for the window to slide (15 RPM)', async () => {
  let t = 0;
  const waits = [];
  const limiter = new RateLimiter({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  for (let i = 0; i < 15; i++) { await limiter.acquire('gemini-3.5-flash-lite', 10); t += 100; }
  assert.deepEqual(waits, []);
  await limiter.acquire('gemini-3.5-flash-lite', 10);
  assert.equal(waits.length, 1);
  assert.equal(waits[0], 60_000 - 1500, 'waited until the first request left the 60 s window');
});

test('rate limiter: token budget per minute is enforced (Gemma 16K TPM)', async () => {
  let t = 0;
  const waits = [];
  const limiter = new RateLimiter({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await limiter.acquire('gemma-4-31b-it', 10_000);
  await limiter.acquire('gemma-4-31b-it', 5_000);
  assert.deepEqual(waits, []);
  await limiter.acquire('gemma-4-31b-it', 3_000);
  assert.deepEqual(waits, [60_000], 'must wait for the first 10K to age out');
  const big = new RateLimiter({ now: () => t, sleep: async () => { throw new Error('should not sleep'); } });
  await big.acquire('gemma-4-31b-it', 100_000); // oversize single request is admitted alone rather than deadlocking
});

test('FakeLlm replays a script, records the requests, and fails loudly when the script runs out', async () => {
  const fake = new FakeLlm(['one', { text: 'two', finishReason: 'length' }]);
  assert.equal((await fake.generate(REQ)).text, 'one');
  assert.equal((await fake.generate(REQ)).finishReason, 'length');
  await assert.rejects(fake.generate(REQ), (e) => e.code === 'FAKE_EXHAUSTED');
  assert.equal(fake.calls.length, 3);
  const failing = new FakeLlm([new Error('boom')]);
  await assert.rejects(failing.generate(REQ), /boom/);
});

test('cassette: record, then replay byte-for-byte without any inner client', async () => {
  const file = path.join(tmp('cassette'), 'c.jsonl');
  const fake = new FakeLlm((req, i) => `answer-${i}-${req.messages.length}`);
  const rec = new CassetteClient({ file, mode: 'record', inner: fake });
  const r1 = await rec.generate(REQ);
  const r2 = await rec.generate({ ...REQ, messages: [...REQ.messages, { role: 'assistant', content: r1.text }, { role: 'user', content: 'more' }] });
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('utf8').trim().split('\n').length, 2);

  const rep = new CassetteClient({ file, mode: 'replay' });
  const p1 = await rep.generate(REQ);
  const p2 = await rep.generate({ ...REQ, messages: [...REQ.messages, { role: 'assistant', content: r1.text }, { role: 'user', content: 'more' }] });
  assert.deepEqual([p1, p2], [r1, r2]);
  assert.equal(JSON.stringify([p1, p2]), JSON.stringify([r1, r2]), 'identical serialisation');
  assert.ok(bytes.equals(fs.readFileSync(file)), 'replay never touches the file');
  assert.equal(rep.stats.live, 0);
});

test('cassette: replay-only treats a miss as a hard error; replay-then-live records only the misses', async () => {
  const file = path.join(tmp('cassette'), 'c.jsonl');
  await new CassetteClient({ file, mode: 'record', inner: new FakeLlm(['recorded']) }).generate(REQ);
  const strict = new CassetteClient({ file, mode: 'replay' });
  await assert.rejects(strict.generate({ ...REQ, temperature: 0.9 }), (e) => e instanceof CassetteMissError && e.code === 'CASSETTE_MISS');

  const live = new FakeLlm(['fresh']);
  const mixed = new CassetteClient({ file, mode: 'replay-then-live', inner: live });
  assert.equal((await mixed.generate(REQ)).text, 'recorded');
  assert.equal(live.calls.length, 0);
  assert.equal((await mixed.generate({ ...REQ, temperature: 0.9 })).text, 'fresh');
  assert.equal(live.calls.length, 1);
  assert.equal((await new CassetteClient({ file, mode: 'replay' }).generate({ ...REQ, temperature: 0.9 })).text, 'fresh');
});

test('cassette: an identical request repeated in one run replays its occurrences in recorded order', async () => {
  const file = path.join(tmp('cassette'), 'c.jsonl');
  const rec = new CassetteClient({ file, mode: 'record', inner: new FakeLlm(['first', 'second']) });
  await rec.generate(REQ);
  await rec.generate(REQ);
  const rep = new CassetteClient({ file, mode: 'replay' });
  assert.equal((await rep.generate(REQ)).text, 'first');
  assert.equal((await rep.generate(REQ)).text, 'second');
  await assert.rejects(rep.generate(REQ), CassetteMissError);
});

test('cassettes hold requests and responses only: no key, headers, or timestamps', async () => {
  const file = path.join(tmp('cassette'), 'c.jsonl');
  const { client } = makeClient(reply(OK));
  await new CassetteClient({ file, mode: 'record', inner: client }).generate(REQ);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(FAKE_KEY) && !/x-goog|authorization|AIza/i.test(text));
  assert.deepEqual(Object.keys(JSON.parse(text)), ['key', 'n', 'request', 'response']);
});

test('cassette: record/replay modes validate their configuration', () => {
  assert.throws(() => new CassetteClient({ file: 'x.jsonl', mode: 'bogus' }), TypeError);
  assert.throws(() => new CassetteClient({ file: 'x.jsonl', mode: 'record' }), TypeError);
  const file = path.join(tmp('cassette'), 'bad.jsonl');
  fs.writeFileSync(file, 'not json\n');
  assert.throws(() => new CassetteClient({ file, mode: 'replay' }), (e) => e.code === 'BAD_CASSETTE');
});
