# Decision log

Each entry: context, decision, evidence, trade-off. Newest at the bottom.

## D1. Language and runtime: stay on Node.js (>=22), zero npm dependencies
Upstream is CommonJS Node with zero dependencies. The inherited journal is
Node. Switching language has no demonstrated benefit and would orphan the
inherited code. Tests use the built-in `node:test`; no test framework dependency.

## D2. Do not reuse upstream's graph scheduler
Evidence (`AUDIT.md` F3; reproduce with `scripts/profile-upstream-scheduler.js`): upstream's
`transitionNode` re-validates the entire graph and state on every transition,
so per-transition cost grows with graph size (0.66 ms at 20 nodes, 3.77 ms at
200 nodes, measured). Its node contract also requires ~12 fields, several of
them opaque digests, that this product has no use for, and it models loops,
conditional edges and quorum joins that are out of scope. Decision: write a
small scheduler with O(degree) transitions; keep upstream's *ideas* (explicit
statuses, bounded attempts/parallelism) and cite it as the comparison point.
Trade-off: we lose upstream's loop/join expressiveness. Accepted.

## D3. Verification gate is a type-level capability, not a convention
Upstream declares `verifier: {required, policy}` on graph nodes but nothing
consults it (AUDIT F1). In this repo a task can enter `succeeded` only via a
function that accepts a `GateVerdict`, and `GateVerdict` objects can only be
produced by `evaluateGate`. Tests assert that forged verdicts (plain objects,
cloned, mutated) are rejected. Trade-off: slightly more ceremony per settle.

## D4. Derive the run log from upstream's journal; do not edit the vendored copy
The vendored journal stays pristine under `third_party/`. The derived log in
`src/log/` changes: (a) a writer lock held for the handle's lifetime, with dead-owner reclamation,
replacing the never-reclaimed per-append pid file (AUDIT F2), (b) arbitrary typed events rather than the fixed
idempotency-checkpoint schema, (c) an in-memory implementation for simulation
with the same chain validation. The vendored original is kept as the
defect reproduction target and parity-tested.

## D5. Baselines are minimal and defined up front
`sequential` and `naive-parallel` trust worker claims, check only that the
result *envelope* is structurally valid, retry on explicit failure up to the
same attempt budget, and have no deadlines, no idempotency journal, and no
cancel propagation. A strawman that trusts malformed envelopes would make the
comparison meaningless, so envelope validity is checked. Content correctness is
not checked by baselines, because that is precisely what a gate adds.

## D6. Ablation: gated at concurrency 1
To avoid attributing to gating what is really parallelism, the benchmark also
runs the gated engine at concurrency 1 (`gated-sequential`).

## D7. Simulated time for the benchmark, wall-clock for the real worker
The benchmark runs on a virtual clock so results are deterministic and fast and
identical across machines. Reported latencies from it are *simulated
milliseconds*, labelled as such everywhere. The real-subprocess path is
covered by end-to-end tests using wall-clock time and reports no performance
claims.

## D8. Fault plans are a pure function of (seed, task, attempt)
So that policy comparisons are paired: for a given seed, attempt k of task t
meets the same fate under every policy. A policy that retries more sees more
attempts, but never different dice for the same attempt.

## D9. Added a closest baseline with timeouts (`naive-parallel-timeout`)
Context: on development seeds, baselines with no deadlines were ended by the run-level cap in over half of the `delay`
and `mixed` runs, which makes the headline gap mostly about timeouts. Decision: add a baseline with the same
deadlines and retry budget as `gated` but without the gate, deduplication, reconcile or cancel propagation, and make it
the primary comparison. Evidence: protocol amendment 1. Trade-off: one more policy (25% more runs). The observation
came from development seeds; no held-out seed had been run.
