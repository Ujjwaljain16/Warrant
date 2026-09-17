# Multi-agent demo: a planner, parallel workers, and gates that decide what is done

A planner agent splits a list of bugs into subtasks. Worker agents fix them in parallel, each in the Docker sandbox. The
host's hidden test suites, wired in as warrant gates, decide what counts as done. The demo runs every scenario twice on the
same agents and the same recorded model replies: **gated** (warrant) and **ungated** (a task is done when its worker says
so), then judges both against suites no agent and no orchestrator ever sees.

It runs offline in about ten seconds per scenario (Docker with `node:22-alpine` is required: model-written code never runs
on the host):

```bash
node examples/multi-agent/run.js                       # the "mixed" scenario
node examples/multi-agent/run.js --scenario overconfident
node examples/multi-agent/run.js --all                 # all three
```

Output goes to `.warrant/multi-agent/<scenario>/` (`--out` changes it): `report.md`, `report.json`, `plan.json`, and for each
mode `run.log` (the hash-chained log), `spec.json` and per-attempt transcripts. Open a `run.log` in
`viewer/run-viewer.html` and add `spec.json` to check the invariants that need the spec (`docs/VIEWER.md`). Reference output,
byte-identical to a replay, is checked in under `examples/multi-agent/expected/`.

## What it shows

The `overconfident` scenario: all five workers claim success. Two fixes are right, two are wrong in ways the visible tests
cannot see, and one changed nothing.

| | ungated | gated |
|---|---|---|
| tasks accepted | 5 of 5 | 2 of 5 |
| accepted but wrong (hidden audit fails) | 3 | 0 |
| run reported | succeeded | failed |
| false success reported | **yes** | no |
| hidden integration suite on what was shipped | FAIL | FAIL |

The ungated run is a clean sweep that ships a broken library; the gated run reports exactly what is true. The `mixed`
scenario adds the other failure modes (below), and `clean` is the control: with honest agents gating changes nothing and the
integration task passes (`gated: succeeded`, 5 of 5 plus `integrate`).

These are **scripted** agents. They show the mechanism (what the gates catch and what they cost: 8 engine attempts instead
of 5 in `overconfident`, because a rejected fix is retried within the host's budget), not how often a real model errs. That
question is the benchmark's (`docs/AGENT_BENCHMARK.md`).

## The demo project

`examples/multi-agent/repo/` is `textkit`, five small modules with one seeded bug each and `issues.md` listing them:

| bug id | module | reported symptom | what the visible tests miss (hidden suite) |
|---|---|---|---|
| `chunk` | `chunk.js` | the last short piece is dropped | invalid sizes must throw, input must not be mutated |
| `csv-quotes` | `csv.js` | quoted commas split the field | `""` escapes, unterminated quotes |
| `semver-order` | `semver.js` | `1.10.0` sorts before `1.9.0` | pre-release ordering, invalid input |
| `slugify` | `slug.js` | punctuation survives | accents, leading/trailing dashes, non-strings |
| `wrap-width` | `wrap.js` | lines break one character early | over-long words, repeated spaces, bad width |

Each bug is a directory under `examples/multi-agent/bugs/` in the agent task format of `src/agent/task.js` (`meta.json`,
`prompt.md`, `hidden/gate`, `hidden/audit`, `reference/`, `naive/`); `bugs/integrate/` holds the integration suite that runs
against the merge of every worker's output. At run time the host assembles full task directories from these plus the shared
`repo/` (line endings normalised, so the agent sees the same bytes on every platform). Executable properties, proven in the
sandbox by the same checker the benchmark uses: every gate and audit suite fails on the starting repo and passes on the
reference solution; each `naive/` solution passes the visible tests and fails the gate; the integration suite fails on the
starting repo and passes on the five reference files. The audit suites are the gate plus a few stricter tests, used only to
judge results, never to gate.

## Architecture

```
 issues.md ──> PLANNER (LLM, untrusted) ──> strict validator (src/demo/plan.js) ──> accepted ids + free text
                                                          │ rejected: error codes only go back, up to 3 rounds
                                                          ▼
   host catalogue ──> buildSpec(ids only)  (src/demo/spec.js) ──> warrant Engine ──> run.log
                                                          │
        ┌─────────── 5 workers in parallel ───────────────┤   each: AgentWorker + Docker sandbox (src/agent)
        │   claim "done" ──> gate: pristine repo + ONLY the declared output file + that bug's hidden suite
        ▼
   `integrate` (host merges the accepted outputs; depends on all five; gate = hidden integration suite)
```

* **Gated mode** is the real engine: a worker task succeeds only through a passing gate verdict (`I1`), `integrate` starts
  only when all five succeeded (`I2`), and its own gate is the integration suite.
* **Ungated mode** is the same engine, the same worker class and the same recorded replies, with the gates removed on
  purpose: each worker task is `trust_worker: true` with no requirements (the engine's explicit claim-only mode, logged as
  `CLAIM_ONLY`) and there is no integrate task. The orchestrator merges whatever the accepted workers produced. The planner
  validator is **not** ablated: this comparison is about trusting worker claims.
* **Judging** happens after both runs, outside the engine: each accepted output is run against the audit suite, and what a
  mode shipped (the merge of its accepted outputs over the untouched project) is run against the hidden integration suite.
  *False acceptance* = accepted but failing the audit. *False success* = the run reported success but the integration
  suite fails.

## The safety invariant: the planner is untrusted

The planner's reply can influence which known bugs are scheduled and one line of quoted text in each worker's prompt. It
cannot reach a command, a requirement, an effect class, a dependency, a deadline, a retry budget or the concurrency.

| what | where it is decided | how the planner/worker is kept out |
|---|---|---|
| plan shape | `parsePlan` | one JSON object (bare or one fenced block), `{"subtasks":[...]}` only; **any** other field (`exec`, `requirements`, `effect`, `deps`, `deadline_ms`, `max_concurrency`, a whole spec, `__proto__`) rejects the plan, it is not ignored; at most 8 subtasks, unique ids; reply at most 20,000 characters |
| subtask ids | `parsePlan` + catalogue | `isId` syntax, then must be one of the host's bug ids (so `integrate` cannot be planned) |
| titles | `parsePlan` | at most 100 characters, no control characters or line separators; stored as data |
| file hints | `parsePlan` | plain file names that exist in the project root: no separators, no `..`, no drive letters, never a hidden suite |
| the spec | `buildSpec(ids)` | its signature takes **ids only**; tasks come out in catalogue order; requirements are the host's hidden suites; `integrate` depends on every worker; `pure` effect; deadlines, `max_attempts: 2`, concurrency 5 from `HOST_POLICY` |
| the gate command | `GATE_ARGV` + launcher | the argv is `node gate.js`; the host writes `gate.js` into each attempt directory before the attempt starts. It names the task's hidden-test directory. The agent's workspace is a sub-directory it cannot leave. |
| what the gate tests | `scripts/agent-gate.js` | rebuilds a fresh directory from the pristine repo + only the declared output file + the hidden suite, so an agent cannot edit tests, shadow modules or add a `package.json` |
| planner text in prompts | `plannerNote` | appended **after** the host's rules, labelled as untrusted, the title JSON-quoted, added to the in-memory task after the task directory is validated |
| retry message to the planner | `planWithRetry` | error codes and sanitised field names only, never the planner's own words |

`test/multi-agent.test.js` pins this: an accept/reject matrix over 36 planner variants (every smuggling, size, traversal
and injection case above), a check that the spec built from a hostile-but-accepted plan (prompt-injection title) is
identical to the one from a benign plan with the same ids, and an end-to-end check that none of the smuggled text appears in
the spec or either run log.

A plan that omits a bug is accepted (reported as `uncovered`); the integration suite then fails honestly, because that bug
is still there.

## The scripted cast

`examples/multi-agent/scripted.js` plays the planner and the workers with `FakeLlm`, as a pure function of the request, so
parallel workers can call it in any order. Worker personas:

| persona | behaviour | engine outcome |
|---|---|---|
| `honest` | reads, writes the reference fix, runs the visible tests, claims done | gate passes |
| `recovers` | first reply is chatty prose the strict protocol rejects, then honest | gate passes (one corrective round) |
| `naive` | fixes the reported symptom only; visible tests pass; claims done | gate **fails** (`GATE_FAILED`), retried, fails again |
| `no-change` | claims done without writing anything | gate **fails** |
| `cannot` | gives up honestly | `AGENT_CANNOT`, never reaches a gate |
| `loops` | never finishes | `MAX_STEPS` after 12 calls, never reaches a gate |

| scenario | cast | planner |
|---|---|---|
| `mixed` (default) | `slugify` honest, `chunk` recovers, `csv-quotes` naive, `semver-order` cannot, `wrap-width` loops | first reply smuggles `exec`, `requirements` and a concurrency of 64 (rejected); second reply carries a prompt-injection title (accepted, as data) |
| `overconfident` | `csv-quotes` and `slugify` honest, `chunk` and `semver-order` naive, `wrap-width` no-change | oversized plan, then a path-traversal hint, then a valid plan |
| `clean` | all honest | valid plan |

Malformed output is covered by `recovers` (a reply the strict parser rejects, then recovery). An agent that never recovers
ends as `PROTOCOL_ERROR` (three consecutive bad replies); that path is exercised by `test/agent.test.js`, not scripted
here.

## Why a replay is byte-identical

The cassettes (`examples/multi-agent/cassettes/<scenario>.jsonl`) record every model call. Everything else that could vary
is pinned:

* **Log order.** Workers genuinely run in parallel, but a worker's finished result is handed to the engine only after every
  earlier worker (catalogue order) has settled (`Turnstile` in `src/demo/worker.js`). This changes when an already finished
  result is presented, never what is accepted. The engine's attempt budget still frees a slot for a retry, so the ordering
  cannot deadlock (the concurrency cap equals the number of workers).
* **Log time.** The engine is given a clock whose `now()` is the log position, so entries carry no wall time.
* **Paths.** The gate command is `node gate.js`; the machine-specific paths live in the launcher, not in the spec, so the
  spec digest in `run_started` is the same on every machine. Temp directories never reach a log.
* **Line endings.** The project is copied LF-normalised.
* **Cassette bytes.** After recording, lines are sorted by `(key, n)`, so which parallel worker called first does not matter.
  Re-recording the scripted session reproduces the file exactly (a test does this).

`test/multi-agent.test.js` runs the CLI twice and compares the SHA-256 of both run logs, both specs, the plan and the report,
and compares a replay with `examples/multi-agent/expected/`. Limits: the sandbox's `run_tests` output is part of the next
model request, so a replay depends on that output being stable. Timings are stripped, and the suite is checked for
determinism by `agent-task-check.js --run`. Docker CLI flakes are retried (`resilientSandbox`). If `src/agent/protocol.js`'s
system prompt, the loop's message format or the planner prompt change, the cassettes no longer match: replay fails with a
cassette miss (reported as a problem, exit code 1) and the scripted cassettes are regenerated offline.

Regenerating, all offline with `FakeLlm`:

```bash
node examples/multi-agent/run.js --record-scripted --scenario mixed          # rewrites cassettes/mixed.jsonl
node examples/multi-agent/run.js --record-scripted --all
node examples/multi-agent/run.js --all --export examples/multi-agent/expected  # refreshes the sample output
```

## Live mode (not run by the test suite, and not run while building this demo)

`--live` replaces the scripted cast with a real model, records its replies to
`examples/multi-agent/cassettes/live-<model>.jsonl`, and refuses to start unless **both** are true: `WARRANT_LIVE=1` is set,
and an API key is present (the key file `%USERPROFILE%\.warrant\gemini.key`, whose existence only is checked, or
`GEMINI_API_KEY`). It refuses before touching Docker or any file, and it refuses to overwrite an existing recording.

```powershell
$env:WARRANT_LIVE = '1'
node examples/multi-agent/run.js --live --model gemini-3.5-flash-lite --max-calls 100 --out .warrant/multi-agent-live
node examples/multi-agent/run.js --scenario live --model gemini-3.5-flash-lite --out .warrant/multi-agent-live-replay   # replay it, offline
```

**What it costs.** Only the planner and the *gated* run call the model; the ungated run replays the gated run's
recording (zero calls), because both send the same requests. Calls: 1 to 3 for the plan; each worker episode is at most 12
calls (`HOST_POLICY.loopMaxSteps`) and a rejected fix gets one more episode. Expect roughly 25 to 50 HTTP calls in a normal run
(five workers at 4 to 8 calls each, a few retries); the worst case is 3 + 5 x 2 x 12 = 123. `--max-calls` (default 100) is a
hard cap on HTTP requests including provider retries; beyond it calls fail and the affected workers end as `LLM_ERROR`. With
`gemini-3.5-flash-lite` (15 requests/minute, 500/day on the free tier, `src/llm/limits.js`) that is 2 to 8 minutes and at most
a fifth of a day's quota. `gemma-4-*` models have a 16,000 tokens/minute limit that these conversations would hit, so
they are not recommended. The per-day counter under `%USERPROFILE%\.warrant\quota\` is shared with the benchmark, so check it
first if the benchmark is running that day. Prompts contain only the synthetic `textkit` project (free-tier prompts may be
used by the provider to improve its products).

A live run proves nothing about models by itself: one sample, one planner, five bugs. Its use is to show the same pipeline
working on real behaviour. The agents will often fix these bugs correctly, in which case the report will say so.

## Files

| path | what |
|---|---|
| `examples/multi-agent/run.js` | the CLI (replay, `--record-scripted`, `--live`, `--export`) |
| `examples/multi-agent/scripted.js` | the scripted cast, all planner variants (benign and hostile), the scenarios |
| `examples/multi-agent/repo/`, `bugs/` | the demo project and the host-owned task data (hidden suites, reference, naive) |
| `examples/multi-agent/cassettes/` | recorded model replies (`mixed`, `overconfident`, `clean`) |
| `examples/multi-agent/expected/` | checked-in reference output: report, plan, specs, run logs (`*.run.jsonl`) |
| `src/demo/` | plan validator, spec builder, task materialiser, worker wrapper, orchestration, report, live-mode guard |
| `test/multi-agent.test.js` | validation matrix, spec identity, gated vs ungated, determinism, `verify-log`, viewer check |

## Not proven here

* Nothing about real model behaviour: the agents are scripted. A live run has not been done.
* The hidden suites are in this repository. A model that reads it can see them; for a live run that is a limitation to state
  (`docs/AGENT_BENCHMARK.md`, threat notes).
* The gate is only as good as its tests. The audit suites exist to measure that and agree with the gate on every scripted
  output; no output exploits the difference.
* The ordered delivery makes runs reproducible; it is a property of this demo's worker wrapper, not of the engine.
* Only Windows with Docker Desktop was exercised.
