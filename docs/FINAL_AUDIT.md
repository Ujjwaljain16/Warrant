# Final audit

Evidence markers: **[verified]** reproduced by a command listed in section 12 during this work; **[preliminary]**
measured but under conditions that limit confidence; **[estimate]** reasoned, not measured; **[not done]** stated so it
is not mistaken for finished work.

## 1. Original project and source revision

Citadel, https://github.com/SethGammon/Citadel, revision `16ab6ee5cd2b351eebde04585a91829a6d65f9da` (v1.4.3, MIT,
2,105 tracked files). An untouched clone is kept at `C:\dev\citadel-upstream`; upstream history was not carried over.
Details and per-file hashes: `UPSTREAM_PROVENANCE.md`.

## 2. Original state and important findings (see AUDIT.md)

| ID | Severity | Finding | Status |
|---|---|---|---|
| F1 | High | Declared node `verifier` policy is never enforced; a node can go `running -> passed` with no evidence | **[verified]** reproduced from upstream's own test; closed by design here (invariant I1) |
| F2 | High | A writer that dies holding the journal lock wedges it permanently | **[verified]** reproduced; fixed in `src/log/runlog.js`, regression-tested against the pristine vendored copy |
| F3 | Medium | Scheduler cost per transition grows with graph size (0.58 -> 3.33 ms from 20 to 200 nodes) | **[verified]**; not reused |
| F4 | Medium | No loop connects scheduler, journal, timeouts and cancellation | **[read]** |
| F5/F6 | Low/Info | Surface area far exceeds the reliability core; upstream tests are host-sensitive | **[verified]** |

Upstream baseline: 10 suite groups failed on this host as-is; **all but one were environmental** (temp dir inside a git
repository, 8 of 9 re-run scripts then pass) and the last is a missing `pwsh`. With the temp dir corrected, one group
fails (`Codex runtime check`, `pwsh` missing) and the security group is 40/40. **No upstream regression was found.**
**Coverage of the audit:** only `core/operations` and `scripts/operation-*` were read line by line. The large majority of
the repository was inventoried, not examined, and may contain further defects **[not done]**.

## 3. Retained, refactored, removed, deferred

- **Retained verbatim** (`third_party/citadel/`, hash-checked on every `npm run check`): `canonical.js`, `constants.js`,
  `validation.js`, `journal.js`, `recovery.js`, the single-step runner and its recovery/chaos tests (5 + 7 tests pass).
- **Refactored/derived:** the journal became `src/log/runlog.js` (lifetime lock, JSONL, typed events, in-memory variant);
  the effect-class recovery table became asynchronous reconcile-before-retry in the engine.
- **Removed (not copied):** graph contracts/scheduler/run/journal/effects, control plane, governance, loops, fleet,
  optimizer and readiness pilots (940 benchmark files), skills, hooks, runtime adapters, installers, dashboards, docs
  site. Per-row reasons in AUDIT.md section 5. Several were not audited, which is itself a reason not to inherit them.
- **Deferred:** signed logs, multi-process coordination, agent-runtime adapters. (A receipt-based reconcile adapter for
  external commands was added later; see sections 6 and 10.)

## 4. Original engineering contributions

All of `src/` except the derivations above; in particular: the `GateVerdict` capability (unforgeable by clone or
lookalike), the state machine without a `running -> succeeded` edge, the O(degree) scheduler, the asynchronous engine
(deadlines, classified retries, per-attempt deduplication, cancellation, worker quiescence, write-ahead log), independent
log audit/replay/resume, the subprocess worker, the deterministic simulation (virtual clock, pure-function fault plans,
ground-truth ledger), five comparison policies, the benchmark harness with paired statistics and auto-generated report,
and the test and check tooling. Authorship of inherited material is not claimed.

## 5. Final architecture and invariants

Module diagram, state machine and recovery semantics: `docs/ARCHITECTURE.md`. Invariants I1-I8 (success requires a
passing verdict for that attempt; dispatch only after dependencies succeed; attempt and concurrency caps; terminal
states absorb; non-repeatable effects not repeated without evidence; one ingestion per attempt; nothing starts after
cancel; hash chain verifies and replay reproduces state) are checked **independently of the engine** by `auditLog` on
every gated benchmark run and by `warrant verify-log --spec`.

## 6. Tests actually executed

Run on Windows 11, Node 22.19, at the commit that produced section 12's numbers. **[verified]**

| Check | Result |
|---|---|
| `npm test` (also from a fresh `git clone`) | 116 / 116 pass |
| `npm run test:upstream-parity` | 5 + 7 upstream tests pass against vendored files |
| `npm run check` | syntax, hygiene, secret patterns and 9 vendored hashes OK; verified to fail on a modified vendored file, a planted key-shaped string and a focused test |
| `npm run coverage` | 94.4% lines, 90.3% branches, 94.5% functions (all files including tests). Uncovered lines are defensive branches (see report) |
| Chaos test | engine killed at every run-log append boundary, before and after persistence, 3 fault profiles on a 16-task graph (several hundred crash points); resume from disk every time |
| Fuzz | 300 cases in the suite; 5,000 and 3,000-case hunts run once, no findings. Safety property plus a separate liveness property |
| Mutation analysis | 13 hand-written mutants of engine, scheduler and gate: 13 / 13 caught by the fast suite (11 / 13 before the unverifiable-requirement tests were added) |
| Real processes | hung child killed at deadline and confirmed dead; cancel kills child before its effect; env scrubbed; output flood; missing binary; symlink output |

Defects in this project's own code, found by testing or review, each with a regression test **[verified]**:
recovery dispatched a second lost task during the first's recovery; a failed final log write left the run promise
unsettled; an empty log was treated as a spec mismatch; verification after a deadline used the already-aborted attempt
signal (found because a benchmark number looked wrong); a non-repeatable task could be retried while its old worker was
still running; artifact names that are Windows device names were accepted; benchmark provenance recorded a falsely dirty
tree. Documentation claims stronger than the code (lock "expiry", "atomic append", "null-prototype reviver") were
corrected rather than left. A mutation survivor ("indeterminate verdict treated as pass") exposed a test gap that is now closed.

The counts in this section are as of the commits named. Later work (agent, gate, sandbox, MCP, viewer, router and demo suites) grew `npm test` to roughly
430 tests; the exact figure is whatever `npm test` prints. The Docker-dependent ones take several minutes and skip cleanly without Docker.

### Later additions: Linux container runs and new tests **[verified]**

Work added after the commit above (uncommitted when written; the commits that introduce it are in `git log`). The suite
grew from 116 tests to the count in the table's last rows. Run in Docker Desktop 29.0.1 (Linux engine on WSL2, kernel
6.6.87.2-microsoft-standard-WSL2) with the `node:22` image (Node v22.23.3), on a fresh copy of the tree with no `.git`:

| Run | What ran | Result |
|---|---|---|
| `git archive HEAD` at `bd6d2e1`, as root | `npm run check`, `npm test`, `npm run test:upstream-parity`, `npm run bench:final` | check OK; 116 / 116; 5 + 7 upstream tests; **`raw.jsonl.gz` decompressed and `summary.json` byte-identical to `results/final`** (sha256 of the decompressed raw records `9af80f98...`, of `summary.json` `738ca334...`) |
| final tree (tracked files plus the new work, no `.git`), as root | the same four, plus the receipt example | check OK; 147 / 147 (0 skipped, so the symlink tests really ran); parity OK; example OK; final benchmark byte-identical again; the partial-requirements experiment reproduced byte-identically against the committed copy (raw and summary) and the first Windows run; `report` on `results/final` regenerates byte-identically |
| final tree, as uid 1000 (`node`) | `npm run check`, `npm test` | check OK; 147 / 147 |

**No Linux-only failure was found, so no production code was changed for Linux.** The Linux-sensitive paths had no
direct tests, so `test/proc-tree.test.js` adds them (grandchildren killed on abort and on deadline, output-flood kill,
attempt-directory containment, `./` argument resolution, symlinked outputs refused); they pass on Windows and on Linux.
What these runs are **not**: not GitHub-hosted runners, not `ubuntu-latest`, not macOS; a Docker Desktop VM shares the
Windows host's WSL2 kernel. The workflow has since run on GitHub-hosted runners (see section 11 for what that covers). The suite is slow in the container
(about 140 s alone, dominated by the fsync-per-append chaos tests), which is a speed observation, not a failure.

## 7. Benchmark methods and measured outcomes

Protocol (frozen, one disclosed amendment): `docs/EVALUATION_PROTOCOL.md`. Held-out run: seeds 10000-10499, 5 workloads x
10 fault profiles x 5 policies x 500 trials = 125,000 runs, clean commit `404dc01`. Artifacts: `results/final/`
(`raw.jsonl.gz`, `summary.json`, `meta.json`, `REPORT.md`, `charts/`). **[verified]** Re-running the whole benchmark at a
later commit (`a6f76cb`, after removing three unused exports) produced **byte-identical raw records and summary**.
The report regenerates byte-identically from `summary.json`.

Headline (all in `REPORT.md`, with CIs; **simulated** workers and times): zero false successes for the gated policy in
every profile (baselines 0.22-0.44 under false claims or mixed faults); zero repeated non-repeatable effects (baselines
0.08-0.19 under crash, invalid output, delay or mixed faults); zero dependency-order violations (naive-parallel 1.2/run
under duplicate delivery); zero effects after a cancel request (closest baseline 1.40/run).
**Losses, also measured:** slower in every profile (+49 ms with no faults, up to +157 ms); 13.5 points fewer tasks
completed when non-repeatable work cannot be reconciled; fewer completions and more wasted tokens under cancel (by
design); no correctness benefit with no faults; against the closest baseline, completion gains under crash, delay and
invalid output are only 0.3-0.6 points.

Protocol deviation to know about: the fifth policy (`naive-parallel-timeout`) was added after development-seed runs
showed the bare baselines were dominated by hangs; it was added before any held-out seed was run and is disclosed in
protocol amendment 1 and decision D9.

### Partial-requirements experiment (protocol v2, extension A) **[verified]**

`docs/EVALUATION_PROTOCOL.md` ("Version 2, extension A"; v1 unchanged), `results/partial-requirements/`. New held-out seeds
20000-20499, 30,000 runs (5 workloads x `false_claim`/`mixed` x `full`/`digest-only`/`shape-only` requirements x `gated` vs
the closest baseline). The first run was made from a **dirty working tree** (`meta.json` records it and the changed
paths). It was then run a second time, unchanged except that the CLI route was renamed, and a third time in Linux. All three
produced byte-identical records and summaries; the committed `meta.json` is from the second run. Re-run
`npm run bench:partial` from a clean commit for a clean-tree record.

Pooled false-success rate: baseline 0.441 (false claims) / 0.290 (mixed). Gated is 0 under `full` and `digest-only` in both
profiles. Under `shape-only` it is **0.441** under false claims (same false-success and correct counts as the baseline on
all 2,500 paired runs) and **0.254** [0.243, 0.266] under mixed faults. Under `mixed`/`shape-only` gated is still better than
the baseline on false-success (-0.036) and correct completion (+0.043), but `unsafe final status` is **worse** by +0.010
(CI [0.003, 0.017]), because gated has fewer wrong tasks and the ones it passes are a larger share of them. The predictions
written beforehand were consistent with the result (they were written after a 20-seed smoke run and are not claimed to be
blind). Gated `shape-only` is also slower than the baseline under false claims (+28 simulated ms on average). Three requirement
sets on one axis, simulated workers: this measures the gate's dependence on its requirements, not how complete real
requirements are.

## 8. Performance changes and measured impact

`docs/PERFORMANCE.md`. Two kept (hash each log entry once; do not revalidate/re-hash an already validated frozen spec),
one rejected (1.02x-1.03x). Combined 1.38x-1.41x on the benchmark runner (interleaved A/B, 7 rounds), raw results
byte-identical before and after. **[preliminary]**: absolute timings were taken on a machine about 48% loaded by other
applications; only the interleaved relative comparisons are reported. Engine overhead scales near-linearly (200 tasks in
about 10 ms including gate and hash-chained log); that comparison with upstream's scheduler is not equal-work.

## 9. Security boundaries and unresolved risks

Boundaries are enforced by host code, not prompts: worker output is typed and untrusted; policy lives only in the spec
and engine; verification is host-side with argv-only commands; subprocesses get a scrubbed environment, a per-attempt
directory, output caps, and tree kill. Full table with the test for each: `docs/THREAT_MODEL.md`.
**Unresolved:** workers run as the invoking user with no OS sandbox; predicate verifiers are trusted in-process code and
a hanging predicate would stall verification (command verifiers have timeouts); Windows tree-kill relies on `taskkill`;
log lock reclamation relies on pid liveness (pid reuse); the hash chain is tamper-evident but unsigned; orphaned worker
processes after an orchestrator crash are not tracked; the gate cannot check what the spec does not require.
Receipt-based reconcile (section 10) additionally trusts the command to write its intent marker before its effect, cannot
tell a forged receipt from a true one, and its "not applied" answer rests on a pid check (descendants that outlive their
parent are not tracked); receipts survive a process crash, not power loss.

## 10. Known limitations and remaining work

- The benchmark uses simulated workers and assumed fault rates; nothing here measures any real model or provider.
- The headline benchmark's requirements are complete by construction, which is the best case for the gate. The
  partial-requirements experiment (section 7) relaxes this on two profiles and three requirement sets **[verified]**; it
  does not say how complete real requirements are, and its committed copy was made from a dirty tree.
- Reconcile exists for one adapter: `ReceiptWorker`, a generic external-command adapter (`"exec": {"receipt": true}`,
  `docs/ARCHITECTURE.md`, `examples/receipt`). Crash-after-effect recovery through the real engine with real subprocesses is
  tested (worker-level, orchestrator-level via `resume`, died before and after the effect, tampered and forged receipts, a
  live process); 6 targeted mutants of its decision rules were all caught **[verified]**. `reconcile` still exists only for that adapter: the agent worker has none, so any other command task still ends
  `unknown` **[not done]**.
- Agent claims experiment (addendum after this audit): an `AgentWorker` (model-driven episode as a warrant Worker), a Docker sandbox, a
  hidden-test gate, 43 original tasks with gate and audit suites (30 held-out final, 10 development, 3 toy), a protocol written before any held-out run (`docs/AGENT_CLAIMS_PROTOCOL.md`), a resumable runner
  and an analysis pipeline exist; the tests (including the Docker-dependent ones) pass offline with scripted models on Windows
  **[verified]**, and a development-stage run against three free-tier models exercised the harness live (it debugs the harness and is
  not a measurement). **The held-out stage has been run** (2026-10-16, clean tree, 180 episodes of two models reached through a
  third-party router, spend 0.235 USD of a 0.40 USD cap): agents claimed "done" on 136 runs and 74 of those claims failed the hidden
  tests (54.4%, task-clustered 95% CI 41.9% to 66.0%); the hidden-test gate accepted 3 of 77 wrong claims, the agent's own visible tests 56
  **[verified, regenerated from the recorded results by `scripts/agent-report.js`]**. Read `docs/AGENT_RESULTS.md` for what limits this: router model
  identity is unverified, `gpt-5.4-mini`'s repeats were byte-identical, the tasks are small and synthetic, 142 of 402 judge replies were cut off
  at the output limit so the LLM judge is not ranked, and the Gemini arms (flash-lite 39 episodes, Gemma 4) are partial because the free tier was
  overloaded and then rate-limited. The false-claim rate depends strongly on the model: flash-lite had 2 audit-wrong claims in 36 (5.6%) against
  37.6% and 88.2% for the router models **[limits]**.
  The sandbox's POSIX permission path was not exercised beyond the Linux CI runner **[not done]**.
- CI has run on GitHub-hosted runners (`ubuntu-latest` and `windows-latest`, Node 22): the first runs passed, and a later run exposed one
  timing-sensitive MCP test, which was made tolerant of slow machines. The same commands also ran on Windows and in a Linux
  container (section 6) **[verified]**; no macOS run **[not done]**.
- `LICENSE` names "Ujjwaljain16" for new work; replace with your legal name if desired.
- Remaining work, in order of value: an agent-runtime adapter with `reconcile`; a macOS run; a verified-identity rerun of the agent study with more models;
  a clean-tree re-run of the partial-requirements experiment; signed run logs; container sandboxing of workers.
- The CLI `USAGE` text listed only `--seeds <final|dev>` when this audit was written; it now lists `dev`, `final` and `partial-requirements`.

## 11. Git history

The first fifteen commits on `main` are listed below; the repository has been extended and pushed since, and `git log` is authoritative. **Honesty note:** the work was developed in one session and committed
afterwards in dependency order; each code commit was tested against exactly its staged content. Commit timestamps
therefore do **not** record when the work was done. The commit dates in `git log` were chosen by the author and are not a
  development timeline; some are earlier than the work they contain (the held-out agent run was made on 2026-10-16, as its
  own `meta.json` and `sessions.jsonl` record, although its data commit carries a September date). When commit dates and the
  timestamps written by the tools disagree, trust the tool-written ones (run metadata, router spend ledger, cassettes).

```
692a934 chore: import selected upstream baseline with attribution
449b4a0 docs: audit upstream and define product scope, trust boundaries and evaluation protocol
556b4c8 refactor: establish explicit core contracts
1cc4f9b fix: replace the never-reclaimed journal lock with a lifetime writer lock
a33fb53 feat: implement the evidence-gated execution engine
bd064b0 test: add crash-recovery chaos test and the resume path tests
62831f5 feat: add the subprocess worker, CLI and a runnable example
6eeb237 feat: add the reproducible benchmark harness
ec1228a chore: add dependency-free repository checks
3224fa9 perf: remove duplicated hashing and repeated spec validation
38e6a2d test: add property-based safety and liveness fuzzing and engine-level unverifiable-requirement tests
b0ceb22 ci: enforce quality and security checks; document usage and provenance
404dc01 fix: capture benchmark provenance before writing results
c0aae13 docs: publish the held-out benchmark results
a6f76cb refactor: remove unused exports
```
(`git log --oneline` is authoritative; this block is copied from it and followed by the commit that adds this file.)

## 12. Commands to reproduce the principal results

```bash
git clone <this repo> warrant && cd warrant      # Node 22+, no install step
npm run check
npm test
npm run test:upstream-parity
npm run example && npm run example:lying          # second one exits 1 by design
npm run bench:final                               # ~3 min; compare with results/final (byte-identical)
npm run bench:partial                             # ~25 s; protocol v2 extension A, writes results/partial-requirements
node examples/receipt/demo.js                     # crash-after-effect recovery from a receipt, real subprocess
node bin/warrant.js report results/final          # regenerates REPORT.md and charts
npm run bench:overhead                            # engine overhead (absolute numbers vary by machine)
node scripts/profile-upstream-scheduler.js ../citadel-upstream   # F3 (needs an upstream clone at that path)
```
