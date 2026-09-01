# Partial-requirements experiment: partial-requirements experiment (protocol v2, extension A)

> **Simulated workers.** Latencies are *simulated milliseconds* and all faults are injected by a seeded model. This is an extension to the frozen v1 protocol (`docs/EVALUATION_PROTOCOL.md`, "Version 2, extension A"); the v1 results in `results/final` are unchanged. It asks what happens to the gate's false-success guarantee when the requirements are **incomplete**.

## Provenance

| field | value |
| --- | --- |
| git commit | `bd6d2e1ccfaae4099aa53c5a5abc15ca246c96e7` (**working tree had uncommitted changes: `.github/workflows/ci.yml`, `.gitignore`, `README.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATION_PROTOCOL.md`, `docs/THREAT_MODEL.md`, `examples/receipt/`, `package.json`, `results/partial-requirements/`, `src/bench/cli.js`, `src/bench/partial.js`, `src/bench/report.js`, `src/cli/main.js`, `src/core/spec.js`, `src/util/proc.js`, `src/workers/command-worker.js`, `src/workers/receipt-worker.js`, `src/workers/receipt.js`, `test/partial.test.js`, `test/proc-tree.test.js`, `test/receipt-worker.test.js`**; re-run from a clean commit for a clean-tree record) |
| protocol / dataset | v2 extension A (base v1) / `workloads-v1` |
| seeds | extension A held-out: 20000..20499 (500 trials per cell); disjoint from the development seeds 0..99 and the v1 held-out seeds 10000..10499; run once |
| cells | 5 workloads x 2 profiles (false_claim, mixed) x 3 requirement sets x 2 policies (naive-parallel-timeout, gated) |
| total runs | 30000 |
| model / provider | none (deterministic simulation) |
| parameters | protocol_version=1, retry_budget=3, gated_deadline_multiple=3, gated_backoff_ms_per_attempt=20, gate_cost_ms_per_requirement=5, tokens_per_worker_ms=10, run_cap_multiple_of_critical_path=30, concurrency_cap=4 |
| environment | node v22.19.0, win32/x64 |
| command | `node bin/warrant.js bench --seeds partial-requirements --out results/partial-requirements` |
| wall-clock to produce | 24.3 s (real time; unrelated to simulated ms) |

Raw per-run results: `raw.jsonl.gz`. Aggregates: `summary.json`. Regenerate this file with `node bin/warrant.js report <this directory>`.

## Requirement sets

| set | what the gate checks | requirements per workload (kind: count) |
| --- | --- | --- |
| full | the v1 requirement set: a pinned sha256 of the output on every task, plus a JSON shape check on about half of them | chain-8: artifact_sha256 8, artifact_json 3; fanout-fanin-12: artifact_sha256 12, artifact_json 7; diamond-lattice-16: artifact_sha256 16, artifact_json 9; pipeline-24: artifact_sha256 24, artifact_json 18; random-dag-32: artifact_sha256 32, artifact_json 17 |
| digest-only | only the pinned sha256 of the output (the v1 set without its shape checks) | chain-8: artifact_sha256 8; fanout-fanin-12: artifact_sha256 12; diamond-lattice-16: artifact_sha256 16; pipeline-24: artifact_sha256 24; random-dag-32: artifact_sha256 32 |
| shape-only | only a JSON shape check (`inputs` object, `n` number, `task` string); no content is pinned | chain-8: artifact_json 8; fanout-fanin-12: artifact_json 12; diamond-lattice-16: artifact_json 16; pipeline-24: artifact_json 24; random-dag-32: artifact_json 32 |

The baseline policy (`naive-parallel-timeout`) never reads requirements, so its rows should be identical across sets; that is checked below rather than assumed.

## Self-checks

- Log audit of every gated run (invariants I1-I8, which are relative to the requirements given, not to ground truth): **0 violations in 15000 audited runs**.
- Baseline records identical across requirement sets: **10000 of 10000** comparisons identical (0 mismatches).
- Runs in which a policy exceeded its concurrency cap: 0.
- Runs ended by the run-level cap: naive-parallel-timeout 0, gated 0.

## Results (pooled over all workloads)

Means with 95% bootstrap CIs over trials. False-success rate = tasks reported `succeeded` that are wrong, over tasks reported `succeeded` (`n/a` when nothing succeeded). Unsafe final status = wrong tasks that were reported `succeeded`, over all wrong tasks.

| profile | requirements | policy | false-success rate | unsafe final status | correct completion | makespan P50 / P95 (sim ms) | attempts/run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| false_claim | full | naive-parallel-timeout | 0.441 [0.429, 0.452] | 1.000 [1.000, 1.000] (n=2238/2500) | 0.559 [0.548, 0.571] | 643 / 919 | 18.4 |
| false_claim | full | gated | 0.000 [0.000, 0.000] (n=2496/2500) | 0.000 [0.000, 0.000] (n=1057/2500) | 0.874 [0.865, 0.883] | 843 / 1210 | 18.1 |
| false_claim | digest-only | naive-parallel-timeout | 0.441 [0.429, 0.452] | 1.000 [1.000, 1.000] (n=2238/2500) | 0.559 [0.548, 0.571] | 643 / 919 | 18.4 |
| false_claim | digest-only | gated | 0.000 [0.000, 0.000] (n=2496/2500) | 0.000 [0.000, 0.000] (n=1057/2500) | 0.874 [0.865, 0.882] | 808 / 1189 | 18.1 |
| false_claim | shape-only | naive-parallel-timeout | 0.441 [0.429, 0.452] | 1.000 [1.000, 1.000] (n=2238/2500) | 0.559 [0.548, 0.571] | 643 / 919 | 18.4 |
| false_claim | shape-only | gated | 0.441 [0.430, 0.453] | 1.000 [1.000, 1.000] (n=2238/2500) | 0.559 [0.547, 0.571] | 673 / 944 | 18.4 |
| mixed | full | naive-parallel-timeout | 0.290 [0.279, 0.301] (n=2485/2500) | 0.825 [0.812, 0.839] (n=2135/2500) | 0.661 [0.650, 0.672] | 1060 / 1667 | 23.4 |
| mixed | full | gated | 0.000 [0.000, 0.000] (n=2477/2500) | 0.000 [0.000, 0.000] (n=1236/2500) | 0.857 [0.849, 0.866] | 1192 / 1881 | 21.8 |
| mixed | digest-only | naive-parallel-timeout | 0.290 [0.279, 0.301] (n=2485/2500) | 0.825 [0.812, 0.838] (n=2135/2500) | 0.661 [0.650, 0.671] | 1060 / 1667 | 23.4 |
| mixed | digest-only | gated | 0.000 [0.000, 0.000] (n=2477/2500) | 0.000 [0.000, 0.000] (n=1236/2500) | 0.857 [0.849, 0.866] | 1173 / 1857 | 21.8 |
| mixed | shape-only | naive-parallel-timeout | 0.290 [0.279, 0.301] (n=2485/2500) | 0.825 [0.812, 0.838] (n=2135/2500) | 0.661 [0.650, 0.671] | 1060 / 1667 | 23.4 |
| mixed | shape-only | gated | 0.254 [0.243, 0.266] (n=2485/2500) | 0.824 [0.810, 0.839] (n=1936/2500) | 0.704 [0.692, 0.714] | 1163 / 1809 | 22.5 |

## Gated vs the closest baseline, per requirement set

Per-seed difference (gated minus `naive-parallel-timeout`) on identical fault plans; "better"/"worse" only when the 95% CI excludes 0; lower is better for false-success, unsafe final status, makespan and attempts, higher for correct completion.

| profile | requirements | false_success_rate | unsafe_final_status | correct_completion | makespan_ms | attempts |
| --- | --- | --- | --- | --- | --- | --- |
| false_claim | full | better (-0.440) | better (-1.000) | better (+0.315) | worse (+152) | better (-0.305) |
| false_claim | digest-only | better (-0.440) | better (-1.000) | better (+0.315) | worse (+131) | better (-0.305) |
| false_claim | shape-only | inconclusive (0.000) | inconclusive (0.000) | inconclusive (0.000) | worse (+28.000) | inconclusive (0.000) |
| mixed | full | better (-0.287) | better (-0.725) | better (+0.197) | worse (+113) | better (-1.572) |
| mixed | digest-only | better (-0.287) | better (-0.725) | better (+0.197) | worse (+96.226) | better (-1.572) |
| mixed | shape-only | better (-0.036) | worse (+0.010) | better (+0.043) | worse (+96.101) | better (-0.859) |

## What incomplete requirements cost the gated policy

Gated with a weaker requirement set minus gated with the `full` set, paired by workload and seed. Same direction rules as above.

| profile | gated: requirement sets | false_success_rate | unsafe_final_status | correct_completion | makespan_ms | attempts |
| --- | --- | --- | --- | --- | --- | --- |
| false_claim | digest-only vs full | inconclusive (0.000) | inconclusive (0.000) | inconclusive (0.000) | better (-20.637) | inconclusive (0.000) |
| false_claim | shape-only vs full | worse (+0.440) | worse (+1.000) | worse (-0.315) | better (-124) | worse (+0.305) |
| mixed | digest-only vs full | inconclusive (0.000) | inconclusive (0.000) | inconclusive (0.000) | better (-16.875) | inconclusive (0.000) |
| mixed | shape-only vs full | worse (+0.252) | worse (+0.724) | worse (-0.154) | better (-17.000) | worse (+0.712) |

## Per-workload false-success and completion

| profile | workload | requirements | gated false-success | baseline false-success | gated correct completion | baseline correct completion |
| --- | --- | --- | --- | --- | --- | --- |
| false_claim | chain-8 | full | 0.000 [0.000, 0.000] (n=497/500) | 0.464 [0.430, 0.498] | 0.984 [0.974, 0.993] | 0.536 [0.502, 0.571] |
| false_claim | chain-8 | digest-only | 0.000 [0.000, 0.000] (n=497/500) | 0.464 [0.432, 0.497] | 0.984 [0.974, 0.993] | 0.536 [0.503, 0.568] |
| false_claim | chain-8 | shape-only | 0.464 [0.432, 0.496] | 0.464 [0.431, 0.496] | 0.536 [0.502, 0.570] | 0.536 [0.502, 0.569] |
| false_claim | fanout-fanin-12 | full | 0.000 [0.000, 0.000] (n=499/500) | 0.326 [0.299, 0.354] | 0.944 [0.936, 0.952] | 0.674 [0.648, 0.701] |
| false_claim | fanout-fanin-12 | digest-only | 0.000 [0.000, 0.000] (n=499/500) | 0.326 [0.299, 0.354] | 0.944 [0.935, 0.952] | 0.674 [0.645, 0.701] |
| false_claim | fanout-fanin-12 | shape-only | 0.326 [0.300, 0.354] | 0.326 [0.300, 0.354] | 0.674 [0.647, 0.701] | 0.674 [0.647, 0.699] |
| false_claim | diamond-lattice-16 | full | 0.000 [0.000, 0.000] | 0.496 [0.473, 0.518] | 0.818 [0.796, 0.840] | 0.503 [0.481, 0.527] |
| false_claim | diamond-lattice-16 | digest-only | 0.000 [0.000, 0.000] | 0.496 [0.474, 0.518] | 0.818 [0.795, 0.838] | 0.503 [0.482, 0.525] |
| false_claim | diamond-lattice-16 | shape-only | 0.496 [0.474, 0.518] | 0.496 [0.474, 0.519] | 0.503 [0.481, 0.526] | 0.503 [0.482, 0.526] |
| false_claim | pipeline-24 | full | 0.000 [0.000, 0.000] | 0.424 [0.406, 0.441] | 0.931 [0.923, 0.939] | 0.576 [0.559, 0.594] |
| false_claim | pipeline-24 | digest-only | 0.000 [0.000, 0.000] | 0.424 [0.406, 0.440] | 0.931 [0.923, 0.939] | 0.576 [0.560, 0.592] |
| false_claim | pipeline-24 | shape-only | 0.424 [0.407, 0.441] | 0.424 [0.407, 0.441] | 0.576 [0.559, 0.594] | 0.576 [0.559, 0.593] |
| false_claim | random-dag-32 | full | 0.000 [0.000, 0.000] | 0.493 [0.469, 0.519] | 0.693 [0.668, 0.717] | 0.507 [0.482, 0.529] |
| false_claim | random-dag-32 | digest-only | 0.000 [0.000, 0.000] | 0.493 [0.470, 0.517] | 0.693 [0.667, 0.717] | 0.507 [0.482, 0.531] |
| false_claim | random-dag-32 | shape-only | 0.493 [0.470, 0.517] | 0.493 [0.470, 0.517] | 0.507 [0.483, 0.530] | 0.507 [0.484, 0.530] |
| mixed | chain-8 | full | 0.000 [0.000, 0.000] (n=487/500) | 0.306 [0.274, 0.340] (n=492/500) | 0.874 [0.850, 0.896] | 0.636 [0.602, 0.669] |
| mixed | chain-8 | digest-only | 0.000 [0.000, 0.000] (n=487/500) | 0.306 [0.273, 0.340] (n=492/500) | 0.874 [0.850, 0.897] | 0.636 [0.604, 0.670] |
| mixed | chain-8 | shape-only | 0.306 [0.274, 0.340] (n=492/500) | 0.306 [0.273, 0.339] (n=492/500) | 0.636 [0.603, 0.670] | 0.636 [0.604, 0.669] |
| mixed | fanout-fanin-12 | full | 0.000 [0.000, 0.000] (n=490/500) | 0.184 [0.165, 0.205] (n=493/500) | 0.918 [0.905, 0.932] | 0.784 [0.763, 0.804] |
| mixed | fanout-fanin-12 | digest-only | 0.000 [0.000, 0.000] (n=490/500) | 0.184 [0.164, 0.203] (n=493/500) | 0.918 [0.904, 0.931] | 0.784 [0.763, 0.806] |
| mixed | fanout-fanin-12 | shape-only | 0.161 [0.142, 0.182] (n=493/500) | 0.184 [0.164, 0.206] (n=493/500) | 0.805 [0.783, 0.828] | 0.784 [0.763, 0.805] |
| mixed | diamond-lattice-16 | full | 0.000 [0.000, 0.000] | 0.396 [0.374, 0.417] | 0.816 [0.793, 0.837] | 0.555 [0.533, 0.576] |
| mixed | diamond-lattice-16 | digest-only | 0.000 [0.000, 0.000] | 0.396 [0.374, 0.417] | 0.816 [0.793, 0.837] | 0.555 [0.533, 0.577] |
| mixed | diamond-lattice-16 | shape-only | 0.298 [0.274, 0.321] | 0.396 [0.374, 0.418] | 0.656 [0.631, 0.681] | 0.555 [0.532, 0.576] |
| mixed | pipeline-24 | full | 0.000 [0.000, 0.000] | 0.245 [0.230, 0.261] | 0.875 [0.862, 0.888] | 0.706 [0.690, 0.722] |
| mixed | pipeline-24 | digest-only | 0.000 [0.000, 0.000] | 0.245 [0.230, 0.260] | 0.875 [0.862, 0.887] | 0.706 [0.691, 0.723] |
| mixed | pipeline-24 | shape-only | 0.240 [0.225, 0.256] | 0.245 [0.230, 0.262] | 0.717 [0.700, 0.732] | 0.706 [0.691, 0.722] |
| mixed | random-dag-32 | full | 0.000 [0.000, 0.000] | 0.316 [0.294, 0.340] | 0.805 [0.783, 0.826] | 0.623 [0.601, 0.645] |
| mixed | random-dag-32 | digest-only | 0.000 [0.000, 0.000] | 0.316 [0.295, 0.339] | 0.805 [0.784, 0.827] | 0.623 [0.601, 0.645] |
| mixed | random-dag-32 | shape-only | 0.265 [0.243, 0.288] | 0.316 [0.295, 0.338] | 0.704 [0.680, 0.729] | 0.623 [0.601, 0.645] |

## Reading these results

- A requirement set is a statement of what the author knows to check. Wherever it is silent, the gate passes whatever the worker claims; a false claim that is well-formed, with the right types and wrong content, is invisible to a shape check.
- Because each task's correct output depends on its dependencies' digests, a wrong output accepted upstream also makes dependants wrong; false successes therefore propagate through the graph.
- The requirement sets here are three points on one axis, chosen before the run; they are not a sample of real requirement quality. The workers are simulated and the fault rates are assumptions (protocol threats 1-3).
- Nothing was tuned after seeing these numbers; the sets, seeds and policies are as listed in the protocol extension.

