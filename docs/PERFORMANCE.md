# Performance notes

Measure first, then change. Everything here was measured on one machine (Windows 11, Intel i5-13450HX hybrid CPU,
Node v22.19.0) that was **about 48% loaded by other applications during measurement** (Docker, browsers). Absolute
numbers are therefore noisy and only relative, interleaved comparisons are reported as evidence. Re-run them with the
commands below; expect different absolute values.

## What was measured

`scripts/profile-bench.js` runs the benchmark trial runner (2 workloads x 3 fault profiles x 5 policies x 100 seeds =
3,000 trials per pass) under the V8 sampling profiler, or times it without the profiler (`--time-only`, 5 steady-state
passes). The interleaved A/B harness alternates invocations of two checkouts (ABABAB..., 7 rounds each) and compares the
distributions of per-invocation minimum and median ms/trial.

## Profile before any change

Top self-time, 3,000 trials:

| self % | function | what it is |
|---:|---|---|
| 12.0 | `canonicalValue` | canonical JSON for the hash chain (vendored `canonical.js`) |
| 9.0 | `validateEntry` | run-log entry validation |
| 8.6 | `canonicalSerialize` | same |
| 5.8 + 3.9 + 3.5 + 1.8 | `Hash` / `digest` / `update` | SHA-256 |
| 4.2 + 1.7 + 1.3 | `validateRunSpec`, `findForbiddenKey`, `deepFreeze` | spec validation, once **per trial** |

Roughly 44% of CPU is the run-log integrity path and about 7% is re-validating the same spec for every trial.

## Optimizations

### O1. Hash each log entry once (kept)

- **Bottleneck:** `buildEntry` validated an entry by calling `validateEntry`, which canonicalized and hashed the entry to
  compare against its `hash` field, discarded that comparison's error, and then canonicalized and hashed the entry again
  to produce the real hash. Two canonical serializations and two SHA-256 per append.
- **Hypothesis:** the first one is pure waste when the hash does not exist yet.
- **Change:** `validateEntry(..., { verifyHash })`; `buildEntry` passes `verifyHash: false`.
- **Result (A/B, 7 rounds):** best per-invocation minimum 1.171 -> 1.035 ms/trial; median of minimums 1.08x faster,
  median of medians 1.10x.
- **Correctness:** the hash is still computed and every read path (`verifyEntries`, `FileRunLog` open, `auditLog`) still
  verifies it. Tamper-detection tests unchanged and passing.

### O2. Do not re-validate or re-hash an already-validated spec (kept)

- **Bottleneck:** every `Engine` (and the benchmark runs 125,000 of them) re-validated the same spec, deep-froze a fresh
  JSON clone, and computed a canonical SHA-256 of the whole spec for the `run_started` event.
- **Hypothesis:** a spec returned by `validateRunSpec` is deep-frozen and so cannot change; validation and digest of the
  same object can be remembered.
- **Change:** a module-private `WeakSet` of specs minted by `validateRunSpec`, and a `WeakMap` of their digests. Anything
  not minted there (a clone, a mutated copy, a plain object) is validated and hashed from scratch.
- **Result (A/B, 7 rounds, against the O1 state):** best per-invocation minimum 1.028 -> 0.826 ms/trial; **1.25x** (median
  of minimums), 1.26x (median of medians).
- **Correctness:** a test shows that a clone gets its own frozen copy, that a mutated clone is rejected, that a validated
  spec cannot be mutated (which is what makes the cache sound), and that digests of unvalidated specs are never served
  from the cache.
- **Trade-off:** a little module state. Semantics are unchanged because the cached facts are about immutable objects.

### O3. Merge the two traversals of event data (rejected)

- **Hypothesis:** `validateEntry` walks the event data three times (plain-JSON check, forbidden-key scan, size).
- **Change tried:** a single custom scanner replacing two simple helpers.
- **Result:** 1.02x-1.03x, within the noise of this machine.
- **Decision:** reverted. A custom scanner replaced two obvious helpers for a gain too small to be distinguished from noise.

### Combined

Original `HEAD` vs O1+O2, 7 interleaved rounds: median of minimums **1.167 -> 0.843 ms/trial (1.38x)**, median of
medians 1.215 -> 0.860 (1.41x).

**Equivalence check:** the same reduced benchmark (3 workloads x 7 profiles x 5 policies x 100 seeds = 10,500 runs) was
run on both trees. `raw.jsonl.gz` contents and `summary.json` are **byte-identical**.

## Engine overhead and scaling

`node scripts/bench-overhead.js 9`: an N-task layered DAG (width 4), instant in-process worker, one SHA-256 requirement
per task, in-memory hash-chained log, real timers. Median of 9 passes after warm-up:

| tasks | log entries | median ms | ms/task |
|---:|---:|---:|---:|
| 20 | 82 | 1.8 | 0.092 |
| 50 | 202 | 3.8 | 0.077 |
| 100 | 402 | 8.5 | 0.085 |
| 200 | 802 | 10.0 | 0.050 |
| 400 | 1602 | 16.8 | 0.042 |

Total time scales with exponent 0.74 over 20 to 400 tasks (1.0 would be linear; the sub-linear value reflects fixed and
JIT warm-up costs being amortized). Per-task cost does not grow with graph size.

For comparison, upstream's scheduler on the same graph shape, **state transitions only** (`scripts/profile-upstream-scheduler.js`):
0.55 ms/transition at 20 nodes rising to 2.81 ms/transition at 200 nodes (1,122 ms total for 200 nodes). This is not
an equal-work comparison: upstream re-validates the whole graph and state at every transition by design (integrity
checking), while this engine validates the spec once and does additional work per task (log append, gate). It supports
the design decision in `DECISIONS.md` D2, not a claim that upstream is slow for its intended graph sizes.

## What was deliberately not optimized

- The `setImmediate` per virtual-clock timer event (needed to drain promise continuations deterministically).
- `fsync` per log entry on the real `FileRunLog` (durability is the point; the chaos test does not need it but disabling
  it showed no measurable gain, so it was left alone).
- Anything in the vendored upstream files.

## Reproduce

```bash
node scripts/profile-bench.js 100            # profile
node scripts/profile-bench.js 100 --time-only
node scripts/bench-overhead.js 9
node scripts/profile-upstream-scheduler.js ../citadel-upstream
```
