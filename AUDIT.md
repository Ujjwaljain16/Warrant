# Audit of the upstream repository (Phase Zero)

| | |
|---|---|
| Project audited | Citadel, https://github.com/SethGammon/Citadel |
| Revision | `16ab6ee5cd2b351eebde04585a91829a6d65f9da` (v1.4.3, 2026-10-15) |
| License | MIT (see `UPSTREAM_PROVENANCE.md`) |
| Host used | Windows 11, Node v22.19.0, npm 10.9.3, no `pwsh` installed |
| Audit scope | The operation-reliability path (`core/operations`, `scripts/operation-*`) read line by line. Everything else inventoried by size and structure, **not** read in depth. |

Evidence markers: **[verified]** reproduced by a command in this repository; **[read]** established by
reading source at the stated lines; **[not audited]** inventoried only.

## 1. Inventory

Citadel is a local orchestration harness that installs skills, hooks, scripts and state files into Claude Code,
Codex and OpenCode projects. **[verified]** 2,105 tracked files; 187 npm scripts; zero npm dependencies
(`package-lock.json` lists only the root package); `core/` ~41k lines of JS and `scripts/` ~71k lines.

| Area | Files | What it is | Audit depth |
|---|---:|---|---|
| `benchmarks/` | 940 | Fixtures, frozen pilots and reports for upstream's own readiness / holdout / economic experiments | not audited |
| `scripts/` | 400 | CLI entry points and ~200 test scripts; `test-all.js` is 53 KB of suite wiring | partially read |
| `core/` | 245 | 40 subdirectories; `operations/`, `control-plane/`, `loops/`, `optimizer/`, `application-readiness/` are the largest | `core/operations` read in full |
| `skills/` | 130 | Prompt/skill catalog | not audited |
| `docs/` | 125 | Documentation and a hosted site | not audited |
| `hooks_src/`, `hooks/` | 42 | Claude Code / Codex hook scripts and a smoke-test | smoke-test run only |
| `runtimes/`, `packs/`, `mcp-servers/`, `dashboard/`, `agents/` | ~58 | Runtime adapters, packs, MCP servers | not audited |

Entry points relevant to this project: `scripts/operation-runner.js` (single-step journaled execution),
`scripts/operation-graph-runner.js` (graph state store), `core/operations/*` (contracts, scheduler, journal,
recovery, receipts). Data flow in the reliability path: spec/graph JSON -> pure scheduler state ->
hash-chained journal files on disk. Model calls: none in this path. Network: none.

## 2. Baseline

`node scripts/test-all.js` on a fresh clone, run from `C:\dev\_baseline` (a throwaway local clone; the
reference clone was never executed in). Raw log: not committed (2,100 lines of upstream output).

| Run | Result |
|---|---|
| As-is on this host (temp dir under my user profile) | 10 suite groups report failure; the security group's 4 failing assertions are all `protect-files` hook checks (36 passed, 4 failed) **[verified]** |
| Same failing scripts re-run with `TEMP`/`TMP` moved outside any git repo | 8 of 9 pass **[verified]** |
| Remaining failure | `test-codex-runtime.js`: `spawnSync pwsh.exe ENOENT` (PowerShell 7 not installed) **[verified]** |
| Full `test-all.js` with corrected temp dir | One suite group still fails: `Codex runtime check` (same `pwsh.exe ENOENT`). The security group goes from 36 passed / 4 failed to **40 passed / 0 failed**; no other group fails **[verified]**. Every other group in `test-all.js` passes. |

Classification of the as-is failures: **environmental, not upstream defects.** Cause (a): upstream's tests create
temporary projects under `os.tmpdir()`; on this host that directory is inside a parent git repository that also
contains a stray `package.json`, which changes `git` and project-root detection (symptoms: `'needs-human' ==
'idle'`, `spawnSync ... ENOBUFS`). Cause (b): `pwsh` missing. Upstream's CI runs on `ubuntu`, `windows`
(git bash) and `macos` images where neither condition holds. No upstream test failure is attributed to a
genuine regression.

Quality tooling: upstream configures no general-purpose JS linter, formatter or type checker (no `eslint`,
`prettier`, `typescript` in the manifest; only a domain linter, `scripts/skill-lint.js`) **[verified]**. CI (`.github/workflows/tests.yml`) has seven jobs (optimizer proof, action consumer,
repository memory, node matrix, windows git-bash, golden path, golden-path matrix) **[read]**.

## 3. Findings

Severity is relative to the goal of *proving that bounded AI work completed correctly*.

### F1 (High) The declared verifier policy is never enforced **[read]** **[verified]**

Graph nodes carry `verifier: { required, policy, evidence_types }`, and `core/operations/graph-contract.js:71-86`
validates its shape, including "`policy` cannot be `none` when `required`". But nothing consults it when a node
changes state:

- `transitionNode(graph, state, nodeId, toStatus)` (`graph-scheduler.js:284-326`) takes no evidence argument and
  accepts `running -> passed` unconditionally.
- `transitionGraphRun` (`graph-run.js:283-301`) wraps it, equally without evidence.
- The only read of `node.verifier` outside validation is `graph-effects.js:362`, which uses
  `evidence_types[0]` as a *label* on an evidence record.

Reproduction: upstream's own test does it. `scripts/test-operation-graph-run.js:33-35` moves node `scope`
(declared `verifier.required: true`) from `running` to `passed` with no evidence. A node that declares required
verification can be marked passed on a bare status change.
Root cause: verification is modelled as data on the node, not as a precondition of the transition.
Impact: "passed" does not mean "verified". This is the gap the project's core invariant (I1) closes.

### F2 (High) A writer that dies holding the journal lock wedges the journal permanently **[verified]**

`journal.js:143-157` creates `.append.lock` with `O_EXCL` containing only a pid; `appendJournalEntry`
(`:176-210`) removes it in a `finally`. If the process dies between the two (kill, power loss, OOM), the file
stays. There is no liveness check, lease, or age test, so every later append throws `Journal append is already
locked` until a human deletes the file.
Reproduction (against the pristine vendored copy, `test/runlog.test.js`, "REGRESSION (documents the upstream defect)"):
```
node --test --test-name-pattern="upstream journal stays wedged" test/runlog.test.js
```
Why upstream's chaos suite did not find it: `operation-runner.js` injects faults only at six boundaries *between*
journal appends (`FAULT_BOUNDARIES`, lines 16-23); none is inside an append.
Impact: a single crash converts "recoverable" into "needs manual intervention", and recovery tooling cannot
help because it needs to append.
Fix in this repository: `src/log/runlog.js` (single writer lock held for the handle's lifetime, dead-owner
reclamation, explicit `breakLock` override); regression-tested with a child process that really dies holding it.

### F3 (Medium) Scheduler cost grows with graph size on every transition, so a run is super-linear **[verified]**

`transitionNode` calls `assertValidOperationGraph`, `assertValidGraphState` and `evaluateGraph` each time
(`graph-scheduler.js:284-291, 301`); `transitionGraphRun` additionally revalidates every traversal token.
Measured with `node scripts/profile-upstream-scheduler.js ../citadel-upstream` (layered DAG, width 4,
`evaluateGraph` + `transitionNode`, no graph-run tokens):

| nodes | transitions | total | per transition |
|---:|---:|---:|---:|
| 20 | 40 | 23.0 ms | 0.58 ms |
| 50 | 100 | 105.6 ms | 1.06 ms |
| 100 | 200 | 367.4 ms | 1.84 ms |
| 200 | 400 | 1331.1 ms | 3.33 ms |

A second run gave 0.66 / 1.23 / 1.94 / 3.77 ms; variation between runs is roughly 10-15%. Per-transition cost is
~5.8x higher at 200 nodes than at 20; total time grows as roughly N^1.76 over this range (20 to 200 nodes). Limits allow up to 256 nodes per graph.
Impact: not a correctness bug; relevant to "bounded concurrency at scale" and the reason this project does not reuse
the scheduler (DECISIONS D2).

### F4 (Medium) No autonomous execution loop connects the scheduler to the journal **[read]**

- `operation-runner.js` `executeStepAttempt` (`:68-109`) is synchronous, takes the effect as a plain function,
  and has no deadline, abort signal, retry budget, or concurrency.
- `operation-graph-runner.js` exposes `init | research-init | status | transition | decide` (`:19`): a
  state store driven by manual `transition` commands, not a dispatcher.
So the pieces for state, idempotent effects and recovery exist, but nothing in the audited path runs bounded
concurrent work with timeouts and cancellation and records the outcome. Other parts of upstream (fleet, loops,
daemon) may do some of this; they were not audited.

### F5 (Low) Surface area far exceeds the reliability core **[verified counts]**

187 npm scripts, 940 benchmark files, 130 skills, three runtime adapters. Most of this is outside what is needed to
answer "did the task complete correctly". It makes the reliability core hard to see and hard to test in isolation.
Not a defect; a reason for the scope cut in section 5.

### F6 (Info) Upstream's own tests are sensitive to the host environment **[verified]**

See section 2. The suite assumes a temp directory outside any git repository and an installed `pwsh`. Not fixed
here (the affected subsystems are not imported).

### Not found

No committed secrets were looked for exhaustively; `SECURITY.md` and `THREAT_MODEL.md` describe an installed
Citadel as "privileged local automation" (hooks, installers). That surface was **not audited** and is not imported.

## 4. Largest risks

1. **Success is asserted, not proven** (F1). Highest value to fix; the centre of this project.
2. **Crash during append is unrecoverable without a human** (F2).
3. **No timeouts / cancellation / concurrency in the audited execution path** (F4): a hung effect blocks forever.
4. **Super-linear scheduling cost** (F3) limits graph size.
5. **Unaudited breadth**: the large majority of the repository was not examined by this audit and may contain further defects.

Missing capabilities that prevent meaningful evaluation: no policy comparison (sequential vs parallel vs
gated), no fault-injection harness that drives a whole workload, no ground-truth ledger independent of the
orchestrator's own report, no paired-seed methodology. Upstream's benchmarks (940 files) measure its own
product-readiness claims, not orchestration reliability under fault.

## 5. Keep / refactor / remove / defer

| Subsystem | Decision | Reason |
|---|---|---|
| `core/operations/{canonical,constants,validation,journal,recovery}` | **Keep** (vendored pristine; behaviour ported) | Sound hash-chain, effect classes, recovery table. Defect F2 fixed in a derived copy. |
| `scripts/operation-runner.js`, `test-operation-{recovery,chaos}.js` | **Keep** (vendored, run as parity tests) | Demonstrates inherited behaviour still holds. |
| `core/operations/graph-{contract,scheduler,run,journal,effects}.js`, `research-graph.js` | **Remove** from this project | F1, F3; node contract needs ~12 mostly-opaque fields; loops/conditional/quorum joins out of scope. Replaced by `src/core/scheduler.js`. |
| `core/operations/{compiler,intents,receipts,conformance,compatibility}.js` | **Defer** | Not needed for the thesis; receipts could later sign run reports. |
| `core/control-plane`, `core/governance`, `core/operation-control*`, `core/proof`, `core/team`, `core/relay` | **Remove** | Not audited; no dependency from the kept core; outside thesis. |
| `core/loops`, `core/coordination`, `core/fleet`, `core/forks`, `core/worktree`, `core/deploy-steward` | **Defer** | Overlapping orchestration concerns; revisit only if multi-process coordination is added. |
| `core/optimizer`, `core/application-readiness`, `core/public-holdout*`, `core/product-proof`, `benchmarks/` | **Remove** | Upstream's own product-claim experiments (940 files). Different question. |
| `core/telemetry`, `core/memory`, `core/config`, `core/adoption`, `core/distribution`, `core/codex`, `core/cli`, `core/runtime`, `core/skills`, `core/campaigns`, `core/intake` | **Remove** | Installer, config and agent-harness plumbing. |
| `skills/`, `agents/`, `packs/`, `hooks_src/`, `hooks/`, `runtimes/`, `mcp-servers/`, `dashboard/`, `docs/` | **Remove** | Product surface for Claude Code / Codex integration; the harness here is runtime-agnostic. |

"Remove" means *not copied into this repository*; upstream is unchanged and remains the source of those components.
Removal is justified per row by irrelevance to the thesis, redundancy with a replacement, or being unaudited and
therefore unsafe to inherit; it is not a claim that the removed code is bad.

## 6. Features deliberately not implemented

- A multi-provider LLM abstraction or any model call in the core (the worker interface is the seam).
- LLM-as-judge verifiers: a non-deterministic gate cannot back an invariant.
- Requirements derived from, or editable by, worker output.
- A dashboard, web UI, daemon, queue, cache or database. The run log is a file.
- A skill/agent catalog, hooks, installers.
- Distributed or multi-host scheduling.
- Loop / conditional / quorum graph constructs.
