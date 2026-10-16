# Overview

Moved from the README. Capability status, a minimal task spec, layout, security and known limitations.

## What it does

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
| Subprocess worker (no shell, scrubbed env, per-attempt dir, kill on deadline/cancel) | implemented |
| Deterministic simulated worker + seeded fault injection | implemented |
| Benchmark: 5 policies x 10 fault profiles x 5 workloads, bootstrap CIs, paired verdicts | implemented |
| Adapter for a specific agent runtime (Claude Code, Codex, ...) | **planned** (the `Worker` interface is the seam) |
| Signed log / receipts | planned |
| OS-level sandboxing of workers | planned (see [threat model](THREAT_MODEL.md)) |
| Real-model evaluation | planned; the simulation says nothing about any real model |

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

## Layout

```
src/core      spec validation, states, scheduler, gate, verifiers
src/engine    engine (gated policy), envelope parsing, replay/audit/resume, baseline policies
src/log       hash-chained run log
src/workers   subprocess worker
src/sim       virtual clock, seeded fault plans, ground-truth world, fake worker
src/bench     workloads, metrics, stats, runner, aggregation, report
src/cli       command line
third_party/  verbatim upstream files (never edited; hashes checked by `npm run check`)
```

## Security and privacy

Worker output is untrusted data; only typed envelope fields are read and nothing a worker says can change policy.
Subprocesses run without a shell, with a scrubbed environment, in a per-attempt directory, and are killed on
deadline or cancel. Logs carry digests and short codes, not artifact bodies. **This is not a sandbox:** workers run
as your user. Run untrusted workers in a container or VM. Details and residual risks:
[docs/THREAT_MODEL.md](THREAT_MODEL.md). No telemetry, no network access, no environment variables required.

## Known limitations

- The benchmark uses simulated workers and assumed fault rates. It shows how the policies behave under that
  fault model, not how any real model behaves.
- The gate is only as strong as the requirements you write. Missing requirements mean missing guarantees.
- After an orchestrator crash, worker processes it had started are not tracked; non-repeatable tasks that were in
  flight are resolved through `reconcile` or end `unknown`. The command worker has no `reconcile`, so those end `unknown`.
- Log lock reclamation relies on process liveness; pid reuse can make a stale lock look live (`breakLock` overrides).
- Verified on Windows 11 / Node 22.19. CI definitions for Linux and Windows are included but were not executed on
  GitHub hosted runners at the time of writing.

