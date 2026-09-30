# Simulated benchmark and partial-requirements experiment

The deterministic fault-injection benchmark behind the headline numbers in the README, with the cases where the gated approach loses. All workers here are simulated; nothing on this page measures a real model (that is [AGENT_RESULTS.md](AGENT_RESULTS.md)).

```bash
npm run bench:dev      # development seeds 0..99, ~1 minute, writes results/dev
npm run bench:final    # held-out seeds 10000..10499, ~5 minutes, writes results/final
npm run bench:partial  # protocol v2 extension A, seeds 20000..20499, ~25 seconds, writes results/partial-requirements
node bin/warrant.js report results/final     # regenerate REPORT.md and charts from summary.json
```

## Held-out results (simulated workers; 500 paired trials per cell)

Pooled over five workloads. "Closest baseline" is `naive-parallel-timeout`: same deadlines and retry budget as the gated
engine, but no gate, no per-attempt deduplication, no reconcile. Times are *simulated* milliseconds. Full tables with
95% bootstrap CIs, per-workload results and charts: [results/final/REPORT.md](../results/final/REPORT.md).

| fault profile | correct completion: sequential / closest baseline / **gated** | false-success rate | duplicate non-repeatable effects | median makespan |
|---|---|---|---|---|
| none | 1.000 / 1.000 / 1.000 | 0 / 0 / 0 | 0 / 0 / 0 | 1684 / 643 / **703** |
| crash | 0.965 / 0.965 / 0.971 | 0 / 0 / 0 | 0.104 / 0.104 / **0** | 1864 / 770 / **847** |
| crash, no reconcile | 0.965 / 0.965 / **0.830** | 0 / 0 / 0 | 0.104 / 0.104 / 0 | 1864 / 770 / 771 |
| delay and hangs | 0.637 / 0.965 / 0.971 | 0 / 0 / 0 | 0 / 0.153 / **0** | 9870 / 1339 / **1404** |
| false claims | 0.558 / 0.558 / **0.876** | 0.442 / 0.442 / **0** | 0 / 0 / 0 | 1684 / 643 / **843** |
| duplicate delivery | 1.000 / 0.898 / 1.000 | 0 / 0.102 / 0 | 0 / 0 / 0 | 1684 / 643 / **703** |
| mixed faults | 0.609 / 0.658 / **0.856** | 0.217 / 0.291 / **0** | 0.083 / 0.190 / **0** | 3870 / 1066 / **1188** |

What this does and does not show:

- **Where the gated approach wins:** it never reported a wrong result as success (0 false successes in every profile),
  never repeated a non-repeatable effect, never dispatched a task before its dependencies succeeded, and began no effect
  after a cancel request (closest baseline: 1.40 effects per run after cancel).
- **Where it loses, measured:** it is slower in simulated time in every profile that has a gate to pay for (+49 ms with
  no faults at all, up to +157 ms under false claims; CIs exclude zero); with non-repeatable work that cannot be
  reconciled (`crash, no reconcile`) it completes **13.5 points fewer tasks** (-0.135, 95% CI [-0.143, -0.126]) because it
  refuses to guess; and under `cancel` it completes fewer tasks and wastes more tokens by design, since it aborts work in flight.
- **With no faults the gate buys nothing** in correctness and costs time.
- **Much of the gap versus a bare baseline is just timeouts.** Against the closest baseline, the completion gains under
  crash, delay and invalid output are 0.3 to 0.6 points; the real differences there are duplicate effects (10 to 15 points)
  and the false-success and cancel rows.
- The false-claim result holds because the benchmark's requirements are complete (digest equality). Real requirements
  are rarely that strong. The workers are simulated and the fault rates are assumptions.

## Partial requirements (protocol v2, extension A; new held-out seeds 20000..20499, run once)

The results above give the gate complete requirements. This experiment relaxes that on the `false_claim` and `mixed`
profiles, with three requirement sets: `full` (the v1 set), `digest-only` (a pinned sha256 on every task) and
`shape-only` (only a JSON shape check; no content is pinned). Pooled false-success rates, with the closest baseline
(`naive-parallel-timeout`, which ignores requirements and so is identical across sets):

| profile | baseline | gated, `full` | gated, `digest-only` | gated, `shape-only` |
|---|---|---|---|---|
| false claims | 0.441 | 0 | 0 | **0.441** (same false-success and correct counts as the baseline on every one of the 2,500 paired runs) |
| mixed faults | 0.290 | 0 | 0 | **0.254** [0.243, 0.266] |

- With a shape check alone the gate stops nothing that is well-formed: under `false_claim` gated is exactly as wrong as the
  baseline (false-success difference 0.000, CI [0, 0]) and also slower (+28 simulated ms on average).
- Under `mixed` the shape check still rejects malformed and missing outputs, so gated is modestly better than the baseline
  (false-success -0.036, correct completion +0.043, both CIs exclude 0) but far from the 0 it reaches with a pinned digest.
- One metric moves the wrong way and is reported as such: `unsafe final status` (wrong tasks reported as succeeded, over all
  wrong tasks) is +0.010 *worse* for gated than the baseline under `mixed`/`shape-only` (CI [0.003, 0.017]), because gated
  has fewer wrong tasks overall and the ones it lets through are a slightly larger share.
- `digest-only` is indistinguishable from `full` on false successes, as predicted in the protocol.
- This shows the cost of weak requirements on three points of one axis, in a simulation. It says nothing about how complete
  real requirements are. The run was made from a **dirty working tree** (provenance in `meta.json`); re-run
  `npm run bench:partial` from a clean commit for a clean-tree record (raw records and summary are deterministic).

Full tables, per-workload results and the paired comparisons: [results/partial-requirements/REPORT.md](../results/partial-requirements/REPORT.md).

Methodology, frozen parameters, metric definitions and threats to validity:
[EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md). Results, with the cases where the gated approach
loses listed automatically: [results/final/REPORT.md](../results/final/REPORT.md). All latencies there are
**simulated** milliseconds and all faults are injected by a seeded model.
