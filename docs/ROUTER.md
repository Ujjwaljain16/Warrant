# The router arm: a third-party OpenAI-compatible router with a hard spend cap

Status: **adapter, ledger and tests built and verified live with seven calls costing $0.000064 (the user then lowered the plan: $0.40 cap, two scheduled agents); not yet wired into the benchmark
runner** (the patch is in the hand-over, `C:\dev\handover\router-adapter.md`, and is not applied to the tree). No benchmark
number has been measured through the router.

## Why

The free Gemini tier limits how many runs and which models Stage B can use. The user has $0.897 of credit on CloseRouter
(`https://api.closerouter.dev/v1`), an OpenAI-compatible router that serves Claude, GPT, Gemini and DeepSeek models at 10-40x below
the vendors' list prices. That credit is the only money this project may spend, so the design is "spend caps first, speed second".

| file | role |
|---|---|
| `src/llm/openai-compat.js` | `OpenAICompatClient`: an `LlmClient` over `POST /chat/completions` (non-streaming) |
| `src/llm/router-budget.js` | `RouterBudget`: the persistent, cross-process spend ledger and the hard cap; `/credits` reading and reconciliation |
| `src/llm/router-models.js` | the allowlist, `GET /models` verification and cache, cost arithmetic, the dry-run estimator, the key loader |
| `test/router.test.js` | 43 offline tests against a local mock router (random port, child processes for the ledger) |

## Identity caveat (read this before quoting any result)

The router is a third party and **the model behind an id cannot be verified from this side**. The prices are far below the vendors'
own, so the id may be a different, smaller, quantised, cached or proxied model. The adapter can check what the router *says*
(the response's `model` field) and nothing more. Consequences:

* Results through the router are described as "the model the router serves as `anthropic/claude-haiku-5.5`", never as "Claude Haiku 5.5".
* Prompts, file contents and model output leave the machine for a third party that may log them. **Synthetic benchmark tasks only**;
  never a real repository, secret or personal data. (The cassettes are made from synthetic tasks for the same reason.)
* The key is a bearer secret for a third party. It is read from `%USERPROFILE%\.warrant\closerouter.key` at the moment of every call, kept
  in a local variable, sent only in the `Authorization` header over https (plain http is accepted for `localhost` only, for the tests),
  and removed (whole, URL-encoded, JSON-escaped, and its first/last 8 characters) from every error, event, journal line and file.
  It is deliberately **not** read from an environment variable, so child processes cannot inherit it.

## Safety model, in the order a call meets it

1. **Allowlist.** Only four ids may be requested. **Scheduled:** `anthropic/claude-haiku-5.5` and `openai/gpt-5.4-mini` (agents) and
   `deepseek/deepseek-v4.1-flash` (judge). **Optional, unscheduled:** `google/gemini-3.8-flash` (Gemini is already covered by the free direct key; it
   stays allowlisted and priced, and is only used if someone names it with `--models`). Anything else is refused before a byte is sent.
2. **Live gate.** `WARRANT_LIVE=1` is required for `generate`, `GET /models` and `GET /credits` alike. Tests never set it.
3. **Price check (`GET /models`, once per six hours, cached in `~/.warrant/router/models-cache.json` with no secrets).** The model must be
   listed, priced in `usd_per_million_tokens`, and no more than **3x** dearer than the built-in table, else the call is refused. The price
   used for accounting is the **higher** of the live and built-in value, so a price drop is never trusted. Cached input is priced as ordinary input.
4. **Pre-flight reservation.** Worst case = `ceil(utf8 bytes / 2.5) + 16 + 8 per message` input tokens (measured real text is 4.4 bytes per
   token, so this is ~1.8x too high on purpose) plus `maxOutputTokens` at the completion price. The ledger reserves that amount under an
   exclusive lock, or refuses with `BudgetExhaustedError`. Reservations of in-flight calls (including other processes') count.
   Two strict per-call ceilings apply before anything is sent: `maxOutputTokens` may not exceed **8192** (the agent loop asks for 8192, the judge for
   4096) and a call whose worst case could cost more than **$0.01** is refused (`OUTPUT_LIMIT`, `CALL_TOO_EXPENSIVE`). Worst case for the dearest scheduled
   model at 100,000 input and 8,192 output tokens is about $0.005. After the reply, a model billed for more output than its limit by over 25% plus 64
   tokens is not honouring `max_tokens` (a runaway reasoner): the call is charged and the run stops with `BudgetExhaustedError`.
5. **The cap.** Total project spend may never exceed `min(cap, spent + balance - $0.20 reserve)`. The cap defaults to **$0.40** and can be
   lowered or raised with `WARRANT_ROUTER_CAP_USD`, but the balance term wins: setting it to 5 still stops at (balance - $0.20).
   The balance is read from `GET /credits` before the first call and again every 10 minutes or 25 calls, and estimated from the ledger in between.
   With no readable balance (and no reading under an hour old) the budget refuses to spend.
6. **Strict reply validation.** A reply with no `choices`, no message, no text content, or invalid or truncated JSON is an `LlmError`
   (`BAD_RESPONSE`), never a `TypeError`. A reply whose `model` differs from the requested id (a provider prefix may be dropped, nothing else)
   is a `ModelMismatchError`, is **not** returned, so `CassetteClient` never records it, and it still **is charged**.
7. **Settlement.** The real cost comes from the usage the reply reports times the price table; if the router also reports `usage.cost` and it
   is higher, that wins. No usage at all means the worst case is charged and `usageEstimated: true` is set. Reasoning tokens are included
   (see below).
8. **Reconciliation.** Each balance refresh compares the ledger's spend since its first reading with the server's. If the server charged more than the
   ledger can explain (>20% plus $0.0005 slack, counting in-flight reservations) the ledger is raised to the server's figure and a warning is
   logged; if the server shows less than 80% of the ledger a warning is logged and the (higher) ledger is kept.
9. **Fail closed.** A corrupted, edited, truncated, wrongly shaped or half-deleted ledger (`ledger.json` missing while `spend.log` exists)
   raises `BudgetLedgerError` and nothing is sent. Nothing ever resets the ledger by itself; to start over on purpose, delete `ledger.json` and `spend.log`.
   A held lock that never frees times out cleanly after 15 s; a lock older than 30 s is treated as left by a dead process and broken.
   Timeouts and dropped connections are charged at the worst case because the call may have been billed; refused connections and HTTP error
   statuses are not charged.

Both `BudgetExhaustedError` and `ModelMismatchError` extend `QuotaExhaustedError`, so the runner's existing handling ("stop this model's lane
cleanly, resume later") applies without changes. Resume with the same command after raising the cap (or topping up credit); finished
runs are skipped and interrupted ones continue from their cassette, so nothing already paid for is paid for twice.

### Where state lives (all under `%USERPROFILE%\.warrant\router\`, outside the repository)

* `ledger.json`: spent, unsettled, in-flight reservations, the last `/credits` reading, the baseline for reconciliation, warnings, a checksum.
* `spend.log`: one JSON line per settlement (id, model, USD). `calls.jsonl`: one line per call with model, **served model**, router request id, request key prefix,
  latency, cost, usage, reasoning tokens and outcome (no prompts, no key).
* `models-cache.json`: the price listing.

Inspect with `node src/llm/router-budget.js status` (offline) and `WARRANT_LIVE=1 node src/llm/router-budget.js reconcile` (reads `/credits`; never spends).
`WARRANT_LIVE=1 node src/llm/router-models.js verify` re-checks the four ids and prices.

## What the live check established (2026-10-16, 7 chat completions, total $0.000064)

* **`GET /credits`**: `total_credits` is the **remaining balance** and `total_usage` is lifetime usage. A paid call costing $0.00001534 (computed
  from the price table) lowered `total_credits` by 0.00001534 and raised `total_usage` by the same amount; seven calls later the server's total
  delta was $0.00006255 against the ledger's $0.000063694 (the ledger errs 1.8% high: it prices cached input at full price). The adapter encodes `remaining`.
* **`GET /models`** returns prices as decimal **strings** (`"0.03000000"`), has extra fields (`aliases`, `access`, `endpoints`) and its
  `supported_parameters` lists only `tools`/`tool_choice`, so it says nothing about `max_tokens` or `temperature`; all four models accepted
  `max_tokens` and `temperature: 0`. (An earlier version of the parser rejected string prices, and failed closed, which is how this was found.)
* **Served model**: every response's `model` field equalled the requested id exactly (`google/...`, `anthropic/...`, `openai/...`, `deepseek/...`).
  That proves only what the router claims.
* **Request ids**: the response header `x-closerouter-request-id` (also in the body as a different `id`); the header value is recorded.
* **Reasoning**: it is billed as output and differs by model. `google/gemini-3.8-flash` reports `completion_tokens: 3` but
  `reasoning_tokens: 100` **separately** (`total_tokens` 124 = 21 + 3 + 100) for "What is 17*23?": the adapter adds reasoning tokens when they exceed
  `completion_tokens`, and the cost then matched the router's own `usage.cost` to the last digit. The reasoning could not be switched off
  (`reasoning_effort: "minimal"` made no difference, `reasoning: {effort: "none"}` reduced it from 100 to 58 tokens), so each Gemini call
  carries a ~60-100 token hidden overhead, which the estimator includes. `deepseek/deepseek-v4.1-flash` returns `reasoning_content` and its
  `completion_tokens` already include it (a 16-token limit was consumed entirely: empty text, `finish_reason: length`), so judge calls need a
  generous `maxOutputTokens` (the protocol's 4096 is fine). Its `total_tokens` is larger than prompt + completion but billing followed prompt + completion.
  Haiku and GPT reported no hidden reasoning.
* **Latency (one trivial call each)**: deepseek 2.7 s, gemini 2.6-7.2 s, claude-haiku 14.6 s, gpt-5.4-mini 36.0 s. Variance is unknown; the runner patch uses two to three episodes in parallel per model.

Not verified: whether the models really are what they say; behaviour under rate limiting (no 429 was seen live; the retry/Retry-After logic is tested only
against the mock); behaviour at 100k-token prompts; whether `usage.cost` can exceed the price table in practice; the router's retention of prompts.

## Using it

Prerequisites: `%USERPROFILE%\.warrant\closerouter.key` (the key alone, one line), `WARRANT_LIVE=1`, Node 22.

```js
const { CassetteClient } = require('./src/llm');
const { OpenAICompatClient } = require('./src/llm/openai-compat');

const router = new OpenAICompatClient({ env: process.env, requestTimeoutMs: 300_000 });   // one instance: one ledger, one concurrency gate
const llm = new CassetteClient({ file: 'bench/agent-claims/cassettes/final/anthropic/claude-haiku-5.5/<task>.<n>.jsonl', mode: 'replay-then-live', storeRequest: false, inner: router });
```

The cassette key is the sha256 of `{model, system, messages, maxOutputTokens, temperature}` with the **router model id**
(`anthropic/claude-haiku-5.5`) in `model`, so router cassettes can never collide with, or be replayed as, a direct-Gemini one; headers and the key are not part of it.
Replay never calls the client, so it makes no HTTP request and spends nothing. A failed or mismatched call throws before `CassetteClient` appends anything.
`CassetteClient` stores `text`, `usage` and `finishReason`; the optional provenance patch also stores `servedModel`, `requestId` and `costUsd` in the response
(the same data is always written to `calls.jsonl`).

With the runner patch from the hand-over:

```bash
node scripts/agent-bench.js --stage final --router --dry-run          # plan and cost estimate; no call
# minimal dev stage: 5 tasks x 1 repeat per router agent (the plan order is repeat 1 of the tasks first, so --limit 5 is exactly that)
WARRANT_LIVE=1 node scripts/agent-bench.js --stage dev --router --limit 5 --spot-max 0
# held-out stage: 30 tasks x 3 repeats per router agent, judge on every output
WARRANT_LIVE=1 node scripts/agent-bench.js --stage final --router --spot-max 0
```

## Stage B budget (plan: two scheduled router agents)

Plan, from the user's update of 2026-10-16: held-out 30 tasks x 3 repeats = **90 runs per router agent** (`anthropic/claude-haiku-5.5`, `openai/gpt-5.4-mini`), the judge
(`deepseek/deepseek-v4.1-flash`) on **every** output (all three variants, not only on `done` claims), and a minimal router dev stage of **5 tasks x 1 repeat = 5 runs per agent**.
Hard cap **$0.40**, never above balance - $0.20.

Cost per agent run is priced from the **measured** token use of the 60 dev-run episodes in `results/agent-claims/dev/runs.jsonl` (three Gemini/Gemma
models, 20 runs each: mean 7.78 model calls, 13,587 input and 1,106 output tokens per run; mean judge call 712 in / 66 out tokens), multiplied by a
**1.5x token margin** (Claude and GPT tokenisers count more tokens than Gemini's on the same text), plus the hidden reasoning output per call (GPT 20; Haiku 0) and
the judge's three variants (about $0.000036 per run). Reproduce with `node src/llm/router-models.js estimate [--inflate 1.5] [--runs 90] [--dev-runs 5] [--cap 0.40]`.

| model | per run (agent + judge) | final, 90 runs | dev, 5 runs | **total** |
|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | $0.001065 | $0.0958 | $0.0053 | **$0.1012** |
| `openai/gpt-5.4-mini` | $0.000739 | $0.0665 | $0.0037 | **$0.0702** |
| both | | $0.1623 | $0.0090 | **$0.1714** |

**Projected total $0.171; margin under the $0.40 cap $0.229 (43% of the cap used).** Sensitivity (same command, other inputs):

| scenario | projected total | margin under $0.40 |
|---|---|---|
| token margin 1.0x (dev-model token counts as they are) | $0.115 | $0.285 |
| **planning figure, 1.5x** | **$0.171** | **$0.229** |
| heaviest dev profile (the dev model that used the most tokens, 21,049 in / 1,711 out per run, 9.55 calls) x1.5 | $0.261 | $0.139 |
| token margin 2.5x | $0.284 | $0.116 |
| token margin 4.5x (extreme) | $0.510, over the cap | -$0.110 |

The projection stays under the $0.30 line in every realistic row. **If a measurement ever pushes it over $0.30, cut the final stage to 2 repeats**
(60 runs per agent instead of 90, `--tasks` unchanged): that saves $0.054 at the planning figure, $0.082 at the heaviest profile, and $0.161 in the
4.5x row (projected total $0.349, margin $0.051). Cutting repeats is the right cut because the protocol's per-task statistics still have two runs per task, whereas dropping the
judge variants or the dev stage would change what is measured; the dev stage is only $0.009 anyway. The ledger, not this table, is the guarantee: it stops the lane
when the cap is reached and the runs not reached are reported as not run.

Risks to these numbers, none measured yet: stronger models may take more steps and read more files than the dev models did (token use per run is the least certain
input); a run that reads large files costs far more (the largest dev run used 109,336 input tokens, about $0.0033 of input alone at Haiku's price); retries after errors cost extra.
The earlier three-agent plan (Gemini 3.8 flash included) would have cost $0.25 at the planning figure; leaving it out saves about $0.09.
