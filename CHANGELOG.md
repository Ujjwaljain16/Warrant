# Changelog

## 0.2.0 (2026-11-16)

Signed logs, a readable CLI, an adapter for command-line coding agents, signature checking in the run viewer, and a Claude arm
of the agent-claims study with a model whose identity is known. This is the current final state of the project.

### Added

- **Claude arm of the agent-claims study** (`docs/AGENT_CLAIMS_CLAUDE_ARM.md`, `scripts/claude-arm.js`): real Claude Haiku 5.5
  through Claude Code on the 30 held-out tasks, gated by the same Docker gate. 0 of 30 claims wrong, against 32 of 85 for the router's
  model of the same name; reported on its own, with the harness difference that keeps the two from being compared directly.
- **The run viewer checks signatures**: drop a log with its `.sig` and public key and the banner says whether the log is signed by
  that key; a re-hashed forgery, which the chain alone accepts, shows "signature does not verify".
- **The replay check names every mismatch** (episode and field) and tolerates only checks listed with a reason in
  `bench/agent-claims/known-flaky.json`. The first entry: a timing-sensitive `retry-async` audit test, disclosed in
  docs/AGENT_RESULTS.md with how far it could move the gate false-accept figure (3 to 6 of the wrong claims).
- Reports name the protocol file recorded in their own `meta.json`.
- **Signed log heads.** `warrant keygen` writes an Ed25519 key pair; `run --sign-key` and `sign-log` sign a finished log's head,
  spec digest and length; `verify-log --pubkey` checks it. A log rewritten with every hash recomputed, which the chain alone
  accepts, now fails (`src/log/signing.js`, `test/signing.test.js`). No dependency: `node:crypto`.
- **`--format text`** for `run`, `resume` and `verify-log`: one line per task with what the gate passed and failed, colour only
  on a terminal and never with `NO_COLOR`. JSON stays the default.
- **Adapter for command-line coding agents** (`examples/agent-cli`): the agent gets the prompt and visible tests, its output is
  gated by hidden tests it never sees. Ships with two offline scripted agents and a Claude Code spec (validated, not run in CI).
- **`exec.env`**: a task may name environment variables it needs (an agent's home directory or API key); only those are passed.
- **Command requirements resolve `./` arguments against the spec's directory**, so a spec can ship hidden checks next to itself.

### Fixed

- `warrant run` refuses to append a second run to an existing log (it used to produce a log that `verify-log` rejects), and the
  two shipped pipeline examples now have separate run ids, so the README's commands work in the order shown.
- Two race and timing problems in the tests: the documentation test's repository copy could meet a folder another test was
  deleting, and an MCP test assumed a run would finish within 200 ms.

### Known gaps in this release

- **Gate v2 is not done.** The gate's misses cluster in one missing check (`query-string`), and an independently written second
  gate suite, re-scored over every recorded solution, would measure how much of the gate's accuracy comes from its author. Not started.
- **The router arm's gate misses could be 3 to 6, not 3**, because one `retry-async` audit test is timing-sensitive
  (`bench/agent-claims/known-flaky.json`, docs/AGENT_RESULTS.md).
- **The Claude arm and the router arm cannot be compared directly**: they differ in harness as well as in who serves the model.
  The real model inside the study's own loop would separate the two and needs an Anthropic API key.
- **The command-line agent adapter has never completed a live run.** One attempt reached Claude Code and stopped at its login.
- **The viewer's signature check** is tested in Node against the engine's own signatures; it has not been tried by hand in a
  regular browser (the in-app preview loads the page without WebCrypto, and the page correctly says it cannot check there).
- **Running the whole test suite at once with Docker on a Windows laptop can overload Docker Desktop.** Each test file passes on
  its own, and CI runs the full suite on Linux and Windows; locally, `node --test --test-concurrency=2` is gentler.
- Unchanged from 0.1.0: command workers are not sandboxed, the Gemini arms are partial, no macOS run.


## 0.1.0

The first tagged release. Everything below exists in the repository and is reproducible with the commands in
[docs/FINAL_AUDIT.md](docs/FINAL_AUDIT.md), section 12. [docs/OVERVIEW.md](docs/OVERVIEW.md) has the capability table.

### Added

- **Engine and log.** Evidence-gated execution: a task reaches `succeeded` only through a host-minted gate verdict. Deadlines,
  bounded classified retries, per-attempt deduplication, cancellation, a hash-chained write-ahead run log, `resume`, and an
  independent `verify-log` audit of invariants I1-I8. Zero npm dependencies; Node 22.
- **Reconcile from receipts** for external commands (`ReceiptWorker`): crash-after-effect recovery without repeating the effect.
- **Simulated benchmark.** 125,000 deterministic runs (5 policies x 10 fault profiles x 5 workloads), byte-reproducible, with the
  cases where the gate loses reported ([docs/BENCHMARK.md](docs/BENCHMARK.md)); plus the partial-requirements experiment
  (protocol v2, extension A).
- **Agent layer.** `AgentWorker`, a Docker sandbox for model-written code, a split-container hidden-test gate (code under test and
  hidden tests never share a process), and 43 original tasks with audit suites.
- **Agent-claims study.** 180 episodes of two models through a third-party router, 30 held-out tasks, a protocol written before the
  run, and a generated report ([docs/AGENT_RESULTS.md](docs/AGENT_RESULTS.md)). The direct Gemini arms are partial.
- **MCP server** that runs human-approved specs by name, an **offline run viewer** that re-verifies the hash chain in the browser,
  and a **multi-agent demo** that replays recorded model output offline.
- **Documentation checks.** `npm run check:docs` fails on a broken link, a README number that differs from its generated report,
  a task count that differs from the task directories, or a phrase known to contradict the code.

### Known gaps in this release

- Command workers are not sandboxed; only model-written code in the agent study runs in Docker ([threat model](docs/THREAT_MODEL.md)).
- The agent-claims figures come from the router arm, whose model identity is unverified. The protocol's primary arm (direct Gemini
  API) is incomplete, and the protocol's Amendments section does not yet record that
  ([AGENT_RESULTS.md](docs/AGENT_RESULTS.md) does).
- No macOS run. The MCP server has not been tested against a live Claude Code session. The viewer was checked in one Chromium-based
  browser only.
- Commit dates in this repository were chosen by the author after the fact and are not a development timeline; trust the
  tool-written timestamps in run metadata ([docs/FINAL_AUDIT.md](docs/FINAL_AUDIT.md), section 11).
