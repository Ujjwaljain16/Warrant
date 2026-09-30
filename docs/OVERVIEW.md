# Overview

What exists, what each piece is for, and what it does not do. The README is the short version; this page is the map.

## Status of each capability

| Capability | Status |
|---|---|
| Typed run spec with validation (ids, cycles, limits, forbidden keys) | implemented |
| Task state machine; `succeeded` reachable only through a minted `GateVerdict` | implemented |
| Gate requirements: `artifact_sha256`, `artifact_json`, `command`, `predicate` (host-side) | implemented |
| Bounded concurrency, per-attempt deadlines, classified bounded retries with backoff | implemented |
| Per-attempt result deduplication; late and duplicate deliveries ignored | implemented |
| Effect classes with reconcile-before-retry for `external-nonrepeatable` tasks | implemented |
| Cancellation that aborts in-flight work and waits for workers to stop | implemented |
| Append-only hash-chained run log (fsync, torn-tail repair, single-writer lock) | implemented |
| `resume` from the log; independent `verify-log` invariant audit | implemented |
| Subprocess worker (no shell, scrubbed env, per-attempt dir, kill on deadline/cancel) | implemented; **not sandboxed** (runs as your user) |
| Deterministic simulated worker + seeded fault injection | implemented |
| Simulated benchmark: 5 policies x 10 fault profiles x 5 workloads, bootstrap CIs, paired verdicts | implemented, [results](BENCHMARK.md) |
| Partial-requirements experiment (protocol v2, extension A) | implemented, [results](BENCHMARK.md) |
| Reconcile from receipts for external commands (`ReceiptWorker`, `"exec": {"receipt": true}`) | implemented; tested with real subprocesses; limits below |
| Agent worker (`AgentWorker`): a model-driven episode as a warrant Worker, Docker-sandboxed, hidden-test gate | implemented; experimental |
| Agent-claims study: 30 held-out tasks, router arm complete, direct Gemini arm **partial** | measured, [results](AGENT_RESULTS.md); small and synthetic, router model identity unverified |
| MCP server: lets a model run human-approved specs by name | implemented, [docs](MCP.md); not tested against a live Claude Code session |
| Offline run viewer: re-verifies the hash chain in the browser | implemented, [docs](VIEWER.md) |
| Multi-agent demo: planner + parallel workers, gated vs ungated, offline replay | implemented, [docs](MULTI_AGENT_DEMO.md); scripted agents, not a measurement |
| Adapters for a specific agent runtime (Claude Code, Codex) | planned |
| Signed log / receipts | planned |
| OS-level sandboxing of general command workers | planned (see [threat model](THREAT_MODEL.md)); model-written code in the agent study is already Docker-sandboxed |

## A minimal task

```json
{
  "id": "sort", "deps": ["fetch"], "effect": "pure",
  "deadline_ms": 10000, "max_attempts": 2, "outputs": ["out"],
  "exec": { "argv": ["node", "./scripts/sort.js"] },
  "requirements": [
    { "id": "exact",     "kind": "artifact_sha256", "artifact": "out", "sha256": "..." },
    { "id": "is-sorted", "kind": "command", "argv": ["node", "-e", "..."] }
  ]
}
```

A task with no requirements is rejected unless it says `"trust_worker": true`, and such a task is reported as
`CLAIM_ONLY`, never as verified. Full example: [examples/pipeline](../examples/pipeline).

## Reconcile for external commands

A non-repeatable task whose worker dies after its effect normally ends `unknown`: the engine will not guess. A command
that follows a small file protocol can instead let the engine find out. Mark the task `"exec": { "argv": [...], "receipt": true }`;
the command calls `markIntent()` just before its effect and `writeReceipt({ outputs })` as its very last step
([src/workers/receipt.js](../src/workers/receipt.js), or write the same files from any language). After a crash, `resume` asks
the worker, which reads the receipt: a valid one means the effect was applied (the output still goes through the gate);
no receipt from a dead process that never wrote its intent means it was not; every other case stays `unknown`.

```bash
node examples/receipt/demo.js   # runs, "crashes" after the effect, resumes; the ledger ends with exactly one line
```

Protocol, evidence rules and limits (the command's honesty is trusted; receipts are not authenticated; pid-based liveness;
crash-safe, not power-loss-safe): [ARCHITECTURE.md](ARCHITECTURE.md#reconcile-from-receipts-receiptworker).

## Layout

```
src/core        spec validation, states, scheduler, gate, verifiers
src/engine      engine (gated policy), envelope parsing, replay/audit/resume, baseline policies
src/log         hash-chained run log
src/workers     subprocess worker; receipt-based reconcile adapter
src/sim         virtual clock, seeded fault plans, ground-truth world, fake worker
src/bench       simulated benchmark (workloads, metrics, stats, runner, report); agent-* = agent-claims runner, judge, analysis
src/agent       model-driven agent loop, AgentWorker, task format
src/gate        split-container hidden-test gate (verdict container + solution container)
src/llm         LLM clients (Gemini direct, OpenAI-compatible router), quota and spend ledgers, cassettes
src/sandbox     Docker sandbox for model-written code
src/mcp         MCP server (bin/warrant-mcp.js)
src/demo        multi-agent demo logic (examples/multi-agent)
src/cli         command line
viewer/         offline run viewer (viewer/run-viewer.html, built from viewer/src)
bench/agent-claims  tasks (dev, final, toy), gate manifest, cassettes
results/        committed benchmark and study outputs, each with provenance (meta.json)
third_party/    verbatim upstream files (never edited; hashes checked by `npm run check`)
```

## Security and privacy

Worker output is untrusted data; only typed envelope fields are read and nothing a worker says can change policy.
Subprocesses run without a shell, with a scrubbed environment, in a per-attempt directory, and are killed on
deadline or cancel. Logs carry digests and short codes, not artifact bodies. **Command workers are not sandboxed:**
they run as your user, so run untrusted workers in a container or VM. Details and residual risks:
[THREAT_MODEL.md](THREAT_MODEL.md).

Everything offline needs no network, no key and no environment variables. The one exception is the optional live mode of the
agent study, which makes real API calls only when `WARRANT_LIVE=1` is set and a key is present; prompts then go to the provider
(or, for the router arm, a third party), so only synthetic tasks are ever sent. No telemetry.

## Known limitations

- The simulated benchmark uses simulated workers and assumed fault rates. It shows how the policies behave under that
  fault model, not how any real model behaves.
- The agent-claims study is small: 30 synthetic tasks, two models behind a router that cannot be verified, one setting.
  The direct Gemini arm the protocol designates as primary is only partial because the free tier was overloaded, so the
  reported pool is the router arm. `gpt-5.4-mini`'s three repeats were byte-identical, so its effective sample is 30 tasks.
  The LLM-judge comparison is inconclusive. See [AGENT_RESULTS.md](AGENT_RESULTS.md).
- The gate is only as strong as the requirements you write. Missing requirements mean missing guarantees.
- After an orchestrator crash, worker processes it had started are not tracked; non-repeatable tasks that were in
  flight are resolved through `reconcile` or end `unknown`. Only tasks marked `"receipt": true` have a `reconcile`; any
  other command task ends `unknown`. The receipt protocol depends on the command writing its intent marker before its
  effect, and it cannot tell a forged receipt from a true one.
- Log lock reclamation relies on process liveness; pid reuse can make a stale lock look live (`breakLock` overrides).
- Verified on Windows 11 / Node 22.19, and in a Linux container (Docker Desktop on WSL2, `node:22` image, Node 22.23, as root and as
  an unprivileged user). CI runs on GitHub-hosted `ubuntu-latest` and `windows-latest` (Node 22); there has been no macOS run.
- Commit dates in this repository were chosen by the author after the fact and are not a development timeline; trust the tool-written
  timestamps in run metadata instead ([FINAL_AUDIT.md](FINAL_AUDIT.md), section 11).
