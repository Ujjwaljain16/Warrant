# Agent claims benchmark: design notes

Status: **harness and tasks built; no measurement reported.** This document describes how the pieces fit. The experimental
protocol (what is measured, outcome definitions, statistics, what would count as a negative result) is
[AGENT_CLAIMS_PROTOCOL.md](AGENT_CLAIMS_PROTOCOL.md). The one recorded episode in `bench/agent-claims/cassettes/` exists to test
record/replay; the dev-stage runs exist to debug the harness. Neither says anything about any model.

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
              |  LlmClient.generate (src/llm)             |  solution container (agent's outputs, no tests)
              |  Workspace (confined copy of repo/)        |       ^ TCP on a shared loopback (no host in between) v
              |  run_tests -> Docker sandbox  <------------+  verdict container (hidden tests; prints the verdict)
```

* **`src/llm/`**: `LlmClient.generate({model, system, messages, maxOutputTokens, temperature}) -> {text, usage, finishReason}`.
  Adapters: `GeminiClient` (REST, `fetch`), `CassetteClient` (record/replay wrapper), `FakeLlm` (scripted, for tests).
* **`src/agent/`**: the model-agnostic loop, the strict JSON action protocol, the confined `Workspace`, the task format,
  the hidden-test gate, and `AgentWorker` (warrant's Worker contract, see `docs/ARCHITECTURE.md`).
* **`src/sandbox/`**: `runInSandbox` (the agent's `run_tests` tool) and `spawnSandbox` (the gate's two interactive containers). Files are
  copied into the container's tmpfs through stdin by a small supervisor (`boot.js`); nothing from the host is mounted.
* **`src/gate/`**: the host side of a gate run (`relay.js`: starts the two containers, enforces the time limit, reads the verdict) and the code that runs inside the two gate containers (`container/`): the membrane that lets a
  hidden test call a solution that lives in another container, the verdict side (`v-main.js`) and the solution side (`s-main.js`).
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

The gate does **not** run tests inside the agent's workspace, and it does **not** run the agent's code in the process that judges it.
`scripts/agent-gate.js` (version `split-1`, `src/agent/gate.js`) starts two containers per hidden test file:

* the **solution container** holds the pristine starting `repo/` with the task's declared `outputs` replaced by the agent's files (regular
  files, no links, size-capped). It has no hidden test and no verdict channel;
* the **verdict container** holds the `hidden/gate/` tests (for the audit suite, also `hidden/audit/`) and the pristine non-output files, and runs
  them with the real `node:test` and `assert`. A test's `require('./solution')` returns a proxy of the module in the other container;
  the two containers talk over one TCP connection on a loopback they share (the verdict container joins the solution container's network
  namespace, which has no other network), without the host in between.

The verdict is one JSON line printed by the verdict container with a per-run nonce. A pass requires the verdict process to exit 0, every test
to pass (none skipped, cancelled or pending), exactly the tests pinned in `bench/agent-claims/gate-manifest.json` (by name and order), and the solution
process still alive when the verdict is complete. Consequently the agent cannot pass by editing the visible tests, shadowing modules with extra
files, writing a `package.json`, exiting the test process, patching `assert`, printing a verdict, or reading the hidden tests; only correct
declared outputs count. `docs/AGENT_CLAIMS_PROTOCOL.md` section 2.5 is the precise description; `docs/THREAT_MODEL.md` T18 lists what remains.
A gate run costs two container start-ups (the verdict container can only start once the solution container is running) plus about half a millisecond per proxied call. The warrant requirement is an ordinary
`command` verifier whose argv is `node scripts/agent-gate.js <task-dir>` with the attempt directory as cwd. The gate also
writes `gate-result.json` there. It distinguishes `fail` from `error` (sandbox unavailable); the engine's command
verifier only sees the exit code, so an infrastructure error reads as a failed gate. That fails safe (it can never
produce a false success) but must be excluded from rates; a real run should preflight Docker and check
`gate-result.json` codes before aggregating.

### Task format

`bench/agent-claims/tasks/dev/<id>/` (10 tasks, harness debugging) and `bench/agent-claims/tasks/final/<id>/` (30 held-out tasks); three
toy tasks used by the plumbing tests live in `bench/agent-claims/toy/`. A task holds `prompt.md`, `repo/` (the only thing the
agent sees, including visible tests), `hidden/gate/` (the warrant gate), `hidden/audit/` (extra, stricter tests, never used to
gate: the audit suite is gate + audit files, a superset by construction, and only measures how often the gate accepts wrong
work), `reference/` (a correct solution: output files only), optional `naive/` (a plausible solution that passes the visible tests
but not the gate) and `meta.json` (split, category, a-priori difficulty, expected pitfall, test commands, whether the visible
tests pass on the starting repo). `scripts/agent-task-check.js --run` proves, for every task and inside the sandbox, with every suite run
twice: gate and audit fail on the starting repo, both pass on `reference/`, the visible tests are in the documented state, a
`naive/` solution passes the visible tests and fails the gate, results are deterministic, ids are unique and no secret-shaped
string is present. `test/agent.test.js` runs the same properties for the toy and dev tasks and the static checks for all of them.

### Experiment runner and analysis

`scripts/agent-bench.js` (`npm run agent:bench`) runs the protocol: resumable over (task, model, repeat), quota-aware (stops at 90% of every
model's daily limit and says when to resume), `--dry-run`, `--replay` (offline from the per-run cassettes), and a judge phase. Each run
goes through the real `Engine` + `AgentWorker` + gate; the harness additionally measures the gate, the audit and the visible tests on
the final workspace of *every* run so the other verification strategies can be scored on the same episodes. `scripts/agent-report.js`
(`src/bench/agent-*.js`) turns `runs.jsonl` and `judgments.jsonl` into `summary.json`, `REPORT.md` and SVG charts with no hand-typed number;
it is unit-tested on synthetic results (`test/agent-bench.test.js`).

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
* A per-model daily counter is persisted under `%USERPROFILE%\.warrant\quota\` (outside the repository): one append-only file
  `calls-<Pacific date>-<model>.log` per model and day (one byte per HTTP request, so concurrent processes never lose a count) and an
  `exhausted-<date>-<model>` marker. Counts in the older `calls-<date>.json` format are still read. Every HTTP request, retries included, is counted. The Pacific date follows Google's midnight-Pacific reset.
* `429` is retried with exponential backoff and jitter, honouring `Retry-After` and the provider's `retryDelay` as a
  floor, up to 120 s; a longer request fails with `RATE_LIMITED` instead of sleeping. A `429` that indicates the daily quota (or a counter at the limit) raises `QuotaExhaustedError`, marks the model
  exhausted for the day, and the worker reports `QUOTA_EXHAUSTED` (non-retryable) so a long run can stop and resume
  after the reset, replaying finished episodes from cassettes.
* `GeminiClient({maxCalls})` is a hard per-process cap for scripted runs.
* Free-tier model ids come from the Gemini docs: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemma-4-31b-it`,
  `gemma-4-26b-a4b-it` (aliases `gemma-4-31b`, `gemma-4-26b` are accepted). Gemma 4 on the Gemini API documents
  `systemInstruction` support; the agent does not rely on native tool calling either way.

## Sandbox

```
docker run --rm --init -i --name warrant-<pid>-<rand> --label warrant=1 --network none --memory 256m --memory-swap 256m --cpus 1
  --pids-limit 128 --ulimit fsize=16777216:16777216 --ulimit nofile=512:512 --user node --read-only --cap-drop ALL
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,size=64m
  --tmpfs /work:rw,nosuid,size=64m,nr_inodes=4096,mode=0755,uid=1000,gid=1000 -w /work -e HOME=/tmp -e CI=1
  node:22-alpine node -e <supervisor> <options json>        # files arrive on stdin
```

* **No host directory is mounted.** The supervisor (`src/sandbox/boot.js`) reads a bundle of files from stdin into the `/work` tmpfs, starts the
  command there, enforces a deadline of its own (10 s after the host's, so it still fires if the orchestrator is killed), and in the gate connects
  descriptors 3 and 4 of the command to a TCP connection on the loopback it shares with the other gate container. What a container writes can not reach the host disk (16 MiB per file,
  64 MB and 4096 inodes in total), and no host path (user name included) is visible inside, in `/proc/self/mountinfo` or elsewhere.
  `runInSandbox({ workspace, mode: 'bind' })` (the default, kept for the tests that read what a container wrote) still bind-mounts the workspace
  with `--mount type=bind`; the agent worker, the gate and the task checker use `mode: 'copy'`.
* Timeout, abort and output-cap overflow all end with `docker rm -f <name>`; killing the client process alone would leave the container running.
  Containers carry `--label warrant=1`; `scripts/agent-bench.js` removes labelled containers older than 15 minutes when it starts.
* At most two containers run at once on the machine, across processes (a lock-file semaphore, `src/sandbox/slots.js`; the docker CLI fails under memory pressure); a gate pair takes both slots. `WARRANT_SANDBOX_CONCURRENCY` changes the limit.
* The image defaults to `node:22-alpine`; `WARRANT_SANDBOX_IMAGE` (e.g. `node:22-alpine@sha256:...`) pins it. `meta.json` of a benchmark run records the
  image id and repository digest actually used.
* The docker CLI gets a small allow-list of profile variables; API keys and other host environment never reach it or the container. Tests
  (`test/sandbox.test.js`) cover: no network, read-only root, no writes outside `/work` and `/tmp`, host siblings invisible, timeout and abort kill the
  container, memory limit, pids limit, output cap, unprivileged user with no capabilities, no host mount, a 300 MB writer, 20 000 files, mountinfo,
  the deadline without the host, the stale-container sweep. They skip, naming the reason, when Docker or the image is unavailable.
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

## Protocol

See [AGENT_CLAIMS_PROTOCOL.md](AGENT_CLAIMS_PROTOCOL.md).
