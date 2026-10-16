# Benchmark

Moved from the README. Headline table plus what it does and does not show.

## Benchmark

```bash
npm run bench:dev      # development seeds 0..99, ~1 minute, writes results/dev
npm run bench:final    # held-out seeds 10000..10499, ~5 minutes, writes results/final
node bin/warrant.js report results/final     # regenerate REPORT.md and charts from summary.json
```

### Held-out results (simulated workers; 500 paired trials per cell)

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

Methodology, frozen parameters, metric definitions and threats to validity:
[docs/EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md). Results, with the cases where the gated approach
loses listed automatically: [results/final/REPORT.md](../results/final/REPORT.md). All latencies there are
**simulated** milliseconds and all faults are injected by a seeded model.

