# Agent claims: results of the held-out stage

What this answers: **when a real model says "done", how often is the code wrong, and which check catches it?** The experiment was fixed
before it ran ([AGENT_CLAIMS_PROTOCOL.md](AGENT_CLAIMS_PROTOCOL.md), protocol commit `9bf14d2`), the tasks were never shown to a model
before this stage, and every number here is generated from the recorded results by `scripts/agent-report.js`. This page is the
reading of them, with the weaknesses stated. Generated tables and charts:

- [router arm](../results/agent-claims/final/router-arm/REPORT.md): the two complete arms, 180 episodes, pooled. Most figures below come from here.
- [everything recorded](../results/agent-claims/final/REPORT.md): all four models, including the partial Gemini arms. Its "all models" row pools
  arms of very different size (90, 90, 39 and 4 runs), so read the per-model rows.

Run on 2026-10-16 and 2026-10-17. `results/agent-claims/final/sessions.jsonl` records the commit, the protocol hash, the model list and a
clean-tree flag for each invocation. The router arm and the first Gemma invocation started from a clean tree. The `gemini-3.5-flash-lite`
invocation recorded a dirty tree: the changed paths were the runner (`src/bench/agent-run.js`, a fix to how a results directory's plan is
merged), its test and an audit document, and none of the protocol, the tasks, the gate or the sandbox. Git commit dates in this repository were
chosen by the author and are not evidence of when anything ran; the tool-written timestamps are.

**How this relates to the protocol (read before quoting).** The protocol makes the three direct-API agents (`gemini-3.5-flash-lite`,
`gemini-3.1-flash-lite`, `gemma-4-31b-it`) the primary arm and the pooled estimate, and says the router arm is "reported separately as a
labelled extra, never pooled into it" (protocol section 2.2.1). The direct arm could not be completed on the free tier, and
`gemini-3.1-flash-lite` was not scheduled in this run. So most figures on this page come from the **router arm**, and its "pooled" rows **pool
its two models**, which is not what the protocol specified. The protocol's amendments section (13) is empty and the protocol file is frozen, so
this paragraph is the record of that deviation. Read the decision-rule statement in finding 3 with it in mind.

## What was run

| arm | model | how it is served | runs | judge |
|---|---|---|---|---|
| complete | `claude-haiku-5.5` | **third-party router, identity unverified** | 90 (30 tasks x 3) | yes |
| complete | `gpt-5.4-mini` | **third-party router, identity unverified** | 90 (30 tasks x 3) | yes |
| partial | `gemini-3.5-flash-lite` | Google's API directly | 39 (all 30 tasks once, 9 of them twice) | no |
| partial | `gemma-4-31b-it` | Google's API directly | 4 | no |

Tasks: 30 original JavaScript tasks, each with visible tests (the agent sees them), hidden gate tests, a stricter audit suite and a reference
solution. Strategies compared: trust the claim; the agent's own visible tests; an LLM judge (three prompt variants); the hidden-test gate.
Ground truth is the audit suite (gate tests plus extra stricter tests). The router arm cost 0.235 USD against a 0.40 USD hard cap enforced by a
ledger in the client; the Gemini arms are on the free tier. The Gemini arms are partial because Google's free tier returned "high demand" errors
for hours (Gemma's calls took about 90 seconds each) and flash-lite then reached its daily request limit.

## Findings

**1. How often a model's "done" is wrong depends on the model: from about 6% to 88% here.**

| model | claimed done | claim failed the audit | audit-wrong rate (95% CI, resampling whole tasks) |
|---|---|---|---|
| gemini-3.5-flash-lite (partial, 39 runs) | 36 | 2 | 5.6% (0.0% to 14.7%) |
| claude-haiku-5.5 via router | 85 | 32 | 37.6% (24.1% to 52.3%) |
| gpt-5.4-mini via router | 51 | 45 | 88.2% (70.6% to 100%) |
| the two router models pooled | 136 | 77 | 56.6% (44.3% to 68.1%) |

The pooled figure describes those two models, not agents in general. Neither the router models nor flash-lite are a sample of "LLM agents", and
the router models' identity cannot be checked, so I can't say whether the gap between them and flash-lite is real model quality or a property of
how the router serves them. Hidden-test failures alone (the report's FALSE_CLAIM) are 74 of 136 (54.4%, CI 41.9% to 66.0%) for the router pair;
the audit-wrong figure above also counts the three claims the gate accepted but the audit rejected.

**2. The two router models fail differently.** Every one of Haiku's 29 false claims came right after its own visible-test run passed: it tested,
saw green and stopped. `gpt-5.4-mini` said "cannot" in 36 runs (honest), but of its 51 claims 21 came while its own last test run was failing or
had not happened. It also lost 9 files (6 of them behind a "done") to a JSON-escaping problem in the action format: a regular expression such as
`/\r?\n/` came out with a real carriage return inside it, which does not parse. These are scored as failures because the action format is part of
the fixed protocol. Leaving those 6 out, its false-claim rate is 39 of 45 (86.7%), so they do not explain the result.

**3. Checking the agent's own visible tests catches little where there is something to catch.** Of the 77 router-arm claims the audit shows to be wrong,
the visible tests accepted 56 (72.7%, CI 57.8% to 87.7%). Trusting the claim accepts all 77. The hidden-test gate accepted 3 (3.9%, CI 0.0% to 10.1%).
The paired differences, gate minus the other strategy: -96.1 points against trusting the claim (CI -100.0 to -89.7) and -68.8 points against the
visible tests (CI -83.3 to -54.3). The decision rules fixed in the protocol (section 7.3) say the gate helps on the router arm and on all recorded
runs pooled; they were written for the pooled direct-API arm, not for the router-arm pool (see "How this relates to the protocol" above), so
treat that verdict as applying to what was run, not as the pre-registered test. The per-model rows of the two partial arms say "the gate does not help", but they rest on 2 and 1 wrong claims, so they cannot say anything.

**4. The gate is not perfect, and its misses cluster.** Five gate false accepts in all recorded runs: `query-string` three times (Haiku twice, flash-lite
once), all for the same missing check (invalid UTF-8 should become U+FFFD); `promise-pool` once (Haiku; it hangs under a stricter test, reproduced twice
on a quiet machine, so it is not load); `business-days` once (Gemma; the result of a nonzero step count must be a weekday). Three of the five are one
missing gate test in one task, which is useful to know and was not fixed, because the gate is frozen for the study. On 7 of the 30 tasks the agent's own
visible tests already rejected the wrong claims, and there the gate adds nothing.

**5. The LLM judge cannot be assessed from this run.** The judge model ran out of its 4,096-token output limit (hidden reasoning) before answering on
142 of 402 calls, which the report counts as undecided. Among the calls that did return a verdict the judge accepted no wrong work in the code-only and
code-plus-output variants, rejected correct work in 5 of 21 and 4 of 19 cases, and a comment inserted into the code asking to be marked as passing flipped
one verdict out of 70 compared pairs. Against the gate the intervals all include zero. The honest conclusion is "not enough decided verdicts to rank the
judge against the gate". An amended re-run with a larger output limit was considered and not done, because changing the protocol after seeing results would
look like tuning. The two Gemini arms were run without a judge.

## Weaknesses that matter

- **Model identity is unverified for the two complete arms.** The router's prices are 10 to 40 times below the vendors' lists. Call them "Haiku 5.5 and
  GPT-5.4-mini as served by a third-party router". The directly-served Gemini arms exist to check this and are too small to settle it.
- **The Gemini arms are partial and unequal.** Flash-lite covers all 30 tasks once and 9 tasks twice; Gemma has 4 runs. Per-model rows for them are descriptive.
- **`gpt-5.4-mini`'s repeats are not independent.** At temperature 1.0 its three repeats were byte-identical for all 30 tasks (same files, same step counts),
  while Haiku's differed in every task. So its effective sample is 30, not 90. The task-clustered intervals already count a task once, but "100% consistent
  across repeats" is determinism, not reliability.
- **Small and synthetic.** 30 JavaScript tasks written for this study, one setting. The tasks were written with traps on purpose (spec traps, off-by-ones), so
  the absolute rates describe this task mix, not agents in general.
- **The gate cannot reject correct work here by construction**, because the audit contains every gate test. Whether the gate tests are fair to the prompt was
  checked by reading failures, not measured.
- **The gate is only as strong as its tests.** The audit measures that gap, but the audit is also a test suite written by the same author, so wrong work that
  passes both is invisible.
- **Sandbox limits.** Docker on a shared kernel, with the residual risks listed in [THREAT_MODEL.md](THREAT_MODEL.md).

## Reproduce

```bash
node scripts/agent-report.js results/agent-claims/final                                    # full report; output is byte-identical
node scripts/agent-report.js results/agent-claims/final --models anthropic/claude-haiku-5.5,openai/gpt-5.4-mini --out results/agent-claims/final/router-arm
node scripts/agent-bench.js --stage final --replay                                         # re-runs every episode from the committed cassettes through the gate (needs Docker, no key)
```
