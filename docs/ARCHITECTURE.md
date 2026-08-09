# Architecture

This document describes the design implemented in this repository. The status of each
module (implemented / experimental / planned) is tracked in the README.

```mermaid
flowchart LR
  spec[run spec JSON] --> V[core/spec<br/>validate + DAG check]
  V --> E[engine/engine<br/>gated policy]
  subgraph engine
    E --> S[core/scheduler<br/>O(degree) ready set]
    E --> ST[core/states<br/>transition table]
    E --> G[core/gate<br/>evaluateGate -> GateVerdict]
  end
  E <-->|dispatch / deliver| W{{Worker interface}}
  W --- FW[sim/fake-worker<br/>seeded faults]
  W --- CW[workers/command-worker<br/>subprocess]
  G --> VK[core/verifiers<br/>sha256 / json / command / predicate]
  E --> L[log/runlog<br/>hash-chained events]
  L --- ML[MemoryRunLog]
  L --- FL[FileRunLog<br/>lease lock]
  L --> R[engine/replay<br/>resume + verify-log]
  B1[engine/baselines<br/>sequential, naive-parallel] <-->|same Worker| W
  BENCH[bench/runner] --> E
  BENCH --> B1
  BENCH --> SIM[sim/clock + faultplan + world<br/>ground-truth ledger]
  SIM --- FW
  BENCH --> RPT[bench/report<br/>raw JSONL, summary JSON, REPORT.md]
```

## Module responsibilities

| Module | Responsibility | Notes |
|---|---|---|
| `src/core/spec.js` | Validate run specs: id syntax, unknown deps, cycles, limits, requirement shapes. Returns a frozen, normalized spec. | Rejects `__proto__` / `constructor` keys. |
| `src/core/states.js` | Status set and transition table; `assertTransition`. | Terminal states absorb. |
| `src/core/gate.js` | `evaluateGate(task, artifacts, verifiers)` returns a frozen, branded `GateVerdict`; `isGateVerdict` checks the brand. | The only source of verdicts. |
| `src/core/verifiers.js` | Requirement kinds: `artifact_sha256`, `artifact_json`, `command`, `predicate`. | Host-side only; never sees worker claims. |
| `src/core/scheduler.js` | Dependency-aware ready set derived from task states; O(degree) per transition. | State-derived readiness, not counter-based. |
| `src/log/runlog.js` | Append-only, hash-chained event log (`MemoryRunLog`, `FileRunLog`) with a lease lock. | Derived from the vendored upstream journal. |
| `src/engine/engine.js` | Gated policy: bounded concurrency, deadlines, retry classification, idempotent ingestion, cancellation, effect-class recovery. | |
| `src/engine/replay.js` | Rebuild state from a log; `resume`; `verifyLog`. | |
| `src/engine/baselines.js` | `sequential` and `naive-parallel` comparison policies. | Intentionally simple. |
| `src/workers/command-worker.js` | Real path: spawn a command in an attempt directory with deadline, kill, output caps. | |
| `src/sim/*` | Virtual clock, seeded fault plan, ground-truth world ledger, fake worker. | Used by tests and benchmarks. |
| `src/bench/*` | Workloads, metrics, statistics, runner, report writer. | |
| `bin/warrant.js` | CLI: `run`, `resume`, `verify-log`, `bench`, `report`. | |

## Worker contract

```
worker.execute(attempt, ctx) -> Promise<void>
  attempt: { runId, taskId, attemptNo, attemptId, idempotencyKey, inputs, task }
  ctx:     { signal: AbortSignal, deliver(envelope), clock }
  envelope: { attemptId, claim: 'success' | 'failure', retryable?: boolean,
              errorCode?: string, artifacts: { [name]: string } }
worker.reconcile?(attempt) -> Promise<{ applied: boolean, artifacts?: {...} }>
```

Results arrive through `ctx.deliver`, which a transport may call more than once
(at-least-once delivery). A rejected promise models a crash. A promise that never
settles models a hang. The engine, not the worker, decides what any of that means.

## Trust boundaries

1. **Worker output is untrusted data.** Envelopes are schema-checked; artifact names are validated
   (no path separators, no traversal, bounded size and count); a claim of success is only an input to the gate.
2. **Verification is host-side.** Requirements come from the spec author, not from the worker.
   Commands run from an argv array (no shell), with a scrubbed environment, a working directory
   confined to the attempt directory, a deadline, and output caps.
3. **Authority lives in the spec and the engine**, not in text a worker emits. No code path lets worker
   output edit a spec, widen a deadline or retry budget, or mark a task verified.

## State machine

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> running: dispatch (all deps succeeded)
  pending --> blocked: a dependency ended non-succeeded
  pending --> cancelled: cancel requested
  running --> verifying: envelope claim=success
  running --> pending: retryable failure, budget left
  running --> failed: non-retryable or budget exhausted
  running --> unknown: ambiguous non-repeatable effect
  running --> cancelled: cancel requested
  verifying --> succeeded: GateVerdict, all requirements pass
  verifying --> pending: gate failed, budget left
  verifying --> failed: gate failed, budget exhausted
  verifying --> unknown: verifier errored or indeterminate
  verifying --> cancelled: cancel requested
  unknown --> verifying: reconcile evidence: applied
  unknown --> pending: reconcile evidence: not applied
  succeeded --> [*]
  failed --> [*]
  blocked --> [*]
  cancelled --> [*]
```

`unknown` is terminal for a run unless a `reconcile` resolution is available.

## Invariants

Checked after the fact, independently of the engine, by `auditLog` in `src/engine/replay.js` (run on every gated benchmark trial and by `warrant verify-log --spec`), and exercised by `engine.test.js`, `resume.test.js` and `bench.test.js`.

- **I1** `succeeded` implies a recorded gate verdict with every requirement passing, bound to the digest of that attempt's artifacts.
- **I2** A task is dispatched only when every dependency is `succeeded`.
- **I3** Attempts per task never exceed the budget; in-flight attempts never exceed the concurrency cap.
- **I4** Terminal states absorb: no transition leaves them (other than the `unknown` reconcile path).
- **I5** An `external-nonrepeatable` task has at most one effect-starting attempt unless a reconcile resolution proves the earlier effect did not apply.
- **I6** Each `(task, attempt)` result is ingested at most once; later deliveries are logged as duplicates and ignored.
- **I7** After cancellation is requested, no new attempt starts.
- **I8** The log hash chain verifies, and `replay(log)` reproduces the live final state.

## Recovery semantics

On resume, tasks the log shows as `running` or `verifying` with no terminal event are classified by effect class using
the decision table inherited from upstream `recovery.js`: `pure` and `workspace-reversible` re-run;
`external-idempotent` re-runs with the same idempotency key; `external-nonrepeatable` becomes `unknown` unless the
worker's `reconcile` returns evidence, in which case the log records the resolution before any further action.
A corrupt log blocks resume (fail closed).

## Configuration authority

The run spec is the single source of execution policy (deadlines, retry budgets, requirements, effect classes).
CLI flags may only lower concurrency below the spec's cap. Environment variables never change policy.
