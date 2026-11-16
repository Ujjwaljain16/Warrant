# Agent claims: Claude arm (written before the run)

An extra arm of the agent-claims study whose model identity is known. It answers the main weakness of the published results
([AGENT_RESULTS.md](AGENT_RESULTS.md)): the two complete arms came through a third-party router that cannot be verified. This arm is
**reported on its own and never pooled** with the router arm or the Gemini arms, because its harness differs (below).

## Fixed before the run

| | |
|---|---|
| Model | Claude Haiku 5.5 (`claude-haiku-5-5`), the same nominal model as the router arm's `anthropic/claude-haiku-5.5` |
| Served by | Anthropic, through Claude Code subagents started from the Claude desktop app (the `Agent` tool with model `haiku`) |
| Tasks | the 30 held-out tasks in `bench/agent-claims/tasks/final`, unchanged; one repeat each |
| Agent sees | a fresh directory outside the repository holding the task's `repo/` files and `prompt.md`; never `hidden/` or `reference/` |
| Agent tools | Claude Code's own (read, write, edit, run commands) instead of the study's JSON action loop; no step limit beyond the subagent's |
| Agent finishes with | a last line `CLAIM: done` or `CLAIM: cannot`, plus `TESTS_RUN: <n>` and `LAST_TEST: pass|fail|none` |
| Measured by | the same code as the study: `runHiddenGate` (split-container Docker gate, suite `gate`), the audit suite, and the visible tests in the sandbox, via `scripts/claude-arm.js score` |
| Outcomes and report | the study's definitions (`src/bench/agent-outcomes.js`) and report builder (`scripts/agent-report.js`) |
| Judge | none |

The instruction each agent receives is fixed in `scripts/claude-arm.js` (`agentInstruction`), so every task gets the same words.

## What would change the reading

- If this arm's wrong-claim rate on "done" is close to the router arm's Haiku rate (37.6%, CI 24.1% to 52.3%), the router result is
  not explained by the router serving a different model. If it is far below, the router's models (or its serving) are the likeliest
  explanation, and the router figures should be read as describing that router, not Haiku.
- Whatever the rate, the comparison of checks (trusting the claim, the agent's own visible tests, the hidden-test gate) on this arm's
  wrong claims is reported the same way as in the main study.

## Known differences and risks, stated in advance

- **Different harness.** Claude Code's tools are richer than the study's JSON actions (no escaping problem, free shell use). A lower
  failure rate may partly come from the harness, not the model.
- **One repeat.** 30 runs, so intervals are wide; per-task patterns are anecdotes.
- **Hidden tests on the same disk.** The agents run as the user on the machine that holds `bench/agent-claims/tasks/final/*/hidden`.
  They are told to stay inside their directory, and their directory is outside the repository, but nothing enforces it. The final
  reports are kept so a reader can check what each agent said it did.
- **Public tasks.** The tasks were published on GitHub in October 2026, after the model's training cutoff (June 2026), so they
  cannot be in its training data, but this cannot be checked.

## Results (run 2026-11-16)

Generated report: [results/agent-claims/claude-arm/REPORT.md](../results/agent-claims/claude-arm/REPORT.md). Each agent's final
report is kept in `run-data/*/agent-report.txt`, with the working-directory path replaced by `<workspaces>`.

| | Claude arm (Haiku 5.5 via Claude Code) | router arm, "claude-haiku-5.5" |
|---|---|---|
| runs | 30 | 90 |
| claimed done | 30 | 85 |
| claims the audit shows to be wrong | **0 of 30** (Wilson 95% upper bound 11.4%) | 32 of 85 (37.6%, CI 24.1% to 52.3%) |
| true successes | 30 of 30 | 53 of 90 |

**Checks on the measurement.** The same gate fails the untouched starting code of all 30 tasks, and every agent changed its file,
so the passes were earned by the agents' code. Every agent ran the visible tests at least once and reported its last run as passing.

**What it means, and what it does not.**
- Real Claude Haiku 5.5 working in Claude Code made no wrong "done" claim on these 30 tasks. The router arm's model of the same name
  was wrong on more than a third of its claims.
- The gap has two explanations this run **cannot separate**: the router may not serve the model it names, or the harness may account
  for it (Claude Code's tools, free shell use and no step cap, against the study's JSON action loop with 20 steps). Telling them apart
  needs the real model inside the study's loop, which needs an Anthropic API key this project did not have.
- With nothing to catch, the decision rule says the gate "does not help" on this arm, and that is the honest reading: when the agent
  is right, the gate only costs a sandbox run. The gate's value is the cases where the agent is wrong, as in the router arm.

**Deviations from this page, stated plainly.**
- This page and `scripts/claude-arm.js` were written before any agent ran, but were **not committed** before the run; the results'
  `meta.json` records the working tree as dirty and the page's SHA-256.
- Agents were told to stay in their directory; that was not enforced or audited (their full transcripts were not retained, only
  their final reports).
- The SHA-256 in `meta.json` was taken when the results were scored, before this Results section was appended, so it matches the
  page as it stood without this section (everything above "Results").
