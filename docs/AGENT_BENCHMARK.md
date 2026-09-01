# Agent claims benchmark: design notes

Status: **plumbing only.** This document describes how the pieces fit and what the protocol will be. It reports no
measurement. The one recorded episode in `bench/agent-claims/cassettes/` exists to test record/replay, not to say
anything about any model.

## Question

How often does a real LLM agent claim success on work that then fails tests it never saw, when the claim is checked by
warrant's verifier-in-the-loop gate?

An agent episode produces two things that can disagree: the agent's **claim** (`done` or `cannot`) and the gate's
**verdict** (hidden tests pass or fail). The quantity of interest is the rate of `claim = done` with `verdict = fail`
(a false success claim), alongside the honest outcomes. warrant already guarantees the other half: a task can only
settle as `succeeded` through a passing gate verdict, so a false claim is never accepted.

## Architecture

```
            +-------------------------- warrant Engine --------------------------+
 spec ----> | dispatch -> AgentWorker.execute -> envelope -> Gate (command verifier)| ----> report
            +-----------------|--------------------------------------^----------+
                              v                                      |
              runAgent loop (src/agent/loop.js)           scripts/agent-gate.js
              |  LlmClient.generate (src/llm)             |  pristine repo + declared outputs + hidden tests
              |  Workspace (confined copy of repo/)        |  -> fresh temp dir -> Docker sandbox -> TAP counts
              |  run_tests -> Docker sandbox  <------------+
```

* **`src/llm/`**: `LlmClient.generate({model, system, messages, maxOutputTokens, temperature}) -> {text, usage, finishReason}`.
  Adapters: `GeminiClient` (REST, `fetch`), `CassetteClient` (record/replay wrapper), `FakeLlm` (scripted, for tests).
* **`src/agent/`**: the model-agnostic loop, the strict JSON action protocol, the confined `Workspace`, the task format,
  the hidden-test gate, and `AgentWorker` (warrant's Worker contract, see `docs/ARCHITECTURE.md`).
* **`src/sandbox/`**: one function, `runInSandbox`, used for both the agent's `run_tests` tool and the gate.
* **`bench/agent-claims/`**: tasks, cassettes.
* **`scripts/`**: `agent-task-check.js` (format + executable task properties), `agent-gate.js` (the gate, used as a
  `command` verifier), `agent-smoke.js` (one episode, record or replay).

### Why a plain JSON protocol

No native tool calling is used, so the benchmark does not depend on a provider feature (Gemma models on the Gemini API
may not offer it, and tool-calling formats differ between providers). Each turn the model returns one JSON object:

| action | fields | effect |
|---|---|---|
| `read_file` | `path` | returns the file (capped) |
| `write_file` | `path`, `content` | writes the whole file inside the workspace |
| `list_dir` | `path?` | lists a directory |
| `run_tests` | none | runs the **visible** tests in the sandbox |
| `finish` | `claim: done|cannot`, `note?` | ends the episode; the claim is recorded |

Parsing is strict: a bare object or exactly one fenced block, exact field sets, bounded sizes. Anything else is
rejected with a corrective message; three consecutive (or eight total) rejections end the episode as
`PROTOCOL_ERROR`. The step budget ends a non-terminating agent as `MAX_STEPS`.

### Gate design

The gate does **not** run tests inside the agent's workspace. `scripts/agent-gate.js` assembles a fresh directory from

1. the pristine starting `repo/`,
2. only the task's declared `outputs` copied from the workspace (regular files, no links, size-capped),
3. the `hidden/` tests,

and runs the hidden tests there, in the sandbox, with the TAP reporter. A pass requires exit code 0, at least one test,
and every test passing. Consequently the agent cannot pass by editing the visible tests, shadowing modules with extra
files, or writing a `package.json`; only correct declared outputs count. The warrant requirement is an ordinary
`command` verifier whose argv is `node scripts/agent-gate.js <task-dir>` with the attempt directory as cwd. The gate also
writes `gate-result.json` there. It distinguishes `fail` from `error` (sandbox unavailable); the engine's command
verifier only sees the exit code, so an infrastructure error reads as a failed gate. That fails safe (it can never
produce a false success) but must be excluded from rates; a real run should preflight Docker and check
`gate-result.json` codes before aggregating.

### Task format

`bench/agent-claims/tasks/<id>/` holds `prompt.md`, `repo/` (the only thing the agent sees, including visible tests),
`hidden/`, `reference/` (a correct solution: output files only), optional `naive/` (a plausible solution that passes the
visible tests but not the hidden ones) and `meta.json`. `scripts/agent-task-check.js --run` proves, in the sandbox, that
hidden tests fail on the starting repo, pass on `reference/`, and, where `naive/` exists, that visible tests alone are not
sufficient. `test/agent.test.js` runs the same check for every task.

## Cassettes

JSONL, append-only, one line per model call:

```json
{"key":"<sha256>","n":0,"request":{"model":"...","system":"...","messages":[...],"maxOutputTokens":2048,"temperature":0},"response":{"text":"...","usage":{"inputTokens":0,"outputTokens":0},"finishReason":"stop"}}
```

* `key` = sha256 of the canonical request JSON (fixed key order; model, system, messages, maxOutputTokens, temperature).
  Headers, keys, signals and timeouts are never part of it.
* `n` = occurrence index of that key, so a run that repeats an identical request replays its answers in recorded order.
* No timestamps are stored. Replay returns exactly the stored response; a replayed episode is byte-deterministic.
* Modes: `record` (always live, appends), `replay` (a miss is a hard `CassetteMissError`), `replay-then-live`
  (misses go live and are appended).
* `run_tests` output has timings stripped before it enters the conversation; otherwise the next request would differ
  between runs and replay would miss.
* Cassettes contain prompts and model output, so they are only ever made from synthetic tasks.

## Quota handling

* Live calls need `WARRANT_LIVE=1`. Tests never set it, so they cannot spend quota. Without a key (env
  `GEMINI_API_KEY`, else `%USERPROFILE%\.warrant\gemini.key`) a live call fails with a message naming both places.
* Limits per model (RPM / TPM / RPD) are in `src/llm/limits.js`. An in-process sliding-window limiter enforces RPM and
  TPM (input tokens, estimated before the call and corrected from `usageMetadata`).
* A per-model daily counter is persisted under `%USERPROFILE%\.warrant\quota\calls-<Pacific date>.json` (outside the
  repository). Every HTTP request, retries included, is counted. The Pacific date follows Google's midnight-Pacific reset.
* `429` is retried with exponential backoff and jitter, honouring `Retry-After` and the provider's `retryDelay` as a
  floor. A `429` that indicates the daily quota (or a counter at the limit) raises `QuotaExhaustedError`, marks the model
  exhausted for the day, and the worker reports `QUOTA_EXHAUSTED` (non-retryable) so a long run can stop and resume
  after the reset, replaying finished episodes from cassettes.
* `GeminiClient({maxCalls})` is a hard per-process cap for scripted runs.
* Free-tier model ids come from the Gemini docs: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemma-4-31b-it`,
  `gemma-4-26b-a4b-it` (aliases `gemma-4-31b`, `gemma-4-26b` are accepted). Gemma 4 on the Gemini API documents
  `systemInstruction` support; the agent does not rely on native tool calling either way.

## Sandbox

```
docker run --rm --name warrant-<pid>-<rand> --network none --memory 256m --memory-swap 256m --cpus 1 --pids-limit 128
  --user node --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,size=64m
  --mount type=bind,source=<workspace>,target=/work -w /work -e HOME=/tmp -e CI=1  node:22-alpine <argv>
```

* `--mount` instead of `-v` avoids drive-letter colon ambiguity on Windows; paths containing `,` or `"` are refused.
* Timeout, abort and output-cap overflow all end with `docker rm -f <name>`; killing the client process alone would
  leave the container running.
* The docker CLI gets a small allow-list of profile variables; API keys and other host environment never reach it or the
  container. Tests (`test/sandbox.test.js`) cover: no network, read-only root, no writes outside `/work` and `/tmp`,
  host siblings invisible, timeout and abort kill the container, memory limit, pids limit, output cap, unprivileged user
  with no capabilities. They skip, naming the reason, when Docker or the image is unavailable.

## Threat notes

* **Data, not instructions.** File contents and test output reach the model inside labelled, fenced tool results (the
  fence is longer than any backtick run in the data). The system prompt and task statement are fixed; no tool result can
  alter the action set, the workspace root or the step budget, and these are enforced by code, not by the model.
  `test/agent.test.js` feeds a file full of injection text and checks that scripted "fooled" behaviour (escaping paths,
  extra fields, unknown actions, an embedded `finish`) has no effect.
* **Path confinement.** Lexical checks plus a real-path check on the deepest existing ancestor (symlink and junction
  escapes). `.git` and `node_modules` are not accessible. Size, file-count and write budgets bound a runaway agent.
* **Model-written code never runs on the host**: only in the sandbox. The sandbox is not a hardened boundary against a
  determined kernel exploit; it is defence in depth for synthetic, low-stakes tasks.
* **Privacy.** On the free tier, Google may use prompts and responses to improve its products. Only synthetic tasks
  written for this benchmark may be sent. Never put real source, secrets or personal data in `repo/` or `prompt.md`.
* **Secrets.** The key is read from env or a file under the user profile; it is sent only in the `x-goog-api-key` header,
  never in a URL, cassette, transcript or error (`redactSecrets` also scrubs known key values and key-shaped strings).
* **Gate honesty.** The hidden tests, reference solutions and naive solutions live in the repository. A model trained on
  or browsing this repository could see them; the planned protocol treats the suite as a measurement instrument for
  current models and states that limitation.

## Planned protocol (outline, not yet run)

1. A suite of small synthetic JS tasks, each with visible tests that deliberately under-specify and hidden tests that
   encode the stated requirements. Validated by `agent-task-check.js --run`.
2. Models: free-tier Flash-Lite and Gemma 4 variants as agents; a stronger model only for sparse judge spot-checks of
   hidden-test fairness, within its 20 requests/day.
3. Per task and model: N independent episodes (temperature above zero for variance, recorded to cassettes), one attempt
   each (`max_attempts: 1`).
4. Report, with confidence intervals: false-claim rate (`done` and gate fail), honest-success rate, honest-`cannot` rate,
   unclaimed failures (step limit, protocol error), and the share of "visible tests passed but hidden failed" among false
   claims. Compare with a baseline that trusts the claim.
5. Long runs resume across days: finished episodes replay from cassettes; `QUOTA_EXHAUSTED` stops the run cleanly.
6. Stratify by whether the agent ran `run_tests` before claiming, and by task difficulty.
