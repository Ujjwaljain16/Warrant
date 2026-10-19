# Changelog

## 0.1.0

The first tagged release. Everything below exists in the repository and is reproducible with the commands in
[docs/FINAL_AUDIT.md](docs/FINAL_AUDIT.md), section 12. [docs/OVERVIEW.md](docs/OVERVIEW.md) has the capability table.

### Added

- **Engine and log.** Evidence-gated execution: a task reaches `succeeded` only through a host-minted gate verdict. Deadlines,
  bounded classified retries, per-attempt deduplication, cancellation, a hash-chained write-ahead run log, `resume`, and an
  independent `verify-log` audit of invariants I1-I8. Zero npm dependencies; Node 22.
- **Reconcile from receipts** for external commands (`ReceiptWorker`): crash-after-effect recovery without repeating the effect.
- **Simulated benchmark.** 125,000 deterministic runs (5 policies x 10 fault profiles x 5 workloads), byte-reproducible, with the
  cases where the gate loses reported ([docs/BENCHMARK.md](docs/BENCHMARK.md)); plus the partial-requirements experiment
  (protocol v2, extension A).
- **Agent layer.** `AgentWorker`, a Docker sandbox for model-written code, a split-container hidden-test gate (code under test and
  hidden tests never share a process), and 43 original tasks with audit suites.
- **Agent-claims study.** 180 episodes of two models through a third-party router, 30 held-out tasks, a protocol written before the
  run, and a generated report ([docs/AGENT_RESULTS.md](docs/AGENT_RESULTS.md)). The direct Gemini arms are partial.
- **MCP server** that runs human-approved specs by name, an **offline run viewer** that re-verifies the hash chain in the browser,
  and a **multi-agent demo** that replays recorded model output offline.
- **Documentation checks.** `npm run check:docs` fails on a broken link, a README number that differs from its generated report,
  a task count that differs from the task directories, or a phrase known to contradict the code.

### Known gaps in this release

- Command workers are not sandboxed; only model-written code in the agent study runs in Docker ([threat model](docs/THREAT_MODEL.md)).
- The agent-claims figures come from the router arm, whose model identity is unverified. The protocol's primary arm (direct Gemini
  API) is incomplete, and the protocol's Amendments section does not yet record that
  ([AGENT_RESULTS.md](docs/AGENT_RESULTS.md) does).
- No macOS run. The MCP server has not been tested against a live Claude Code session. The viewer was checked in one Chromium-based
  browser only.
- Commit dates in this repository were chosen by the author after the fact and are not a development timeline; trust the
  tool-written timestamps in run metadata ([docs/FINAL_AUDIT.md](docs/FINAL_AUDIT.md), section 11).
