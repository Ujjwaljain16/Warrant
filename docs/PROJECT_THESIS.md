# Project thesis

## Primary user and problem

**User:** an engineer who lets AI workers (agents, scripts, tool-using models) do
bounded pieces of a larger job and has to decide, afterwards, whether the job
actually got done.

**Problem:** orchestration code usually records what a worker *said*. A task
becomes "done" because the worker returned success. Under real failure
conditions (worker crashes mid-effect, slow or hung tools, malformed output,
at-least-once delivery, partial progress, cancellation) that is not evidence.
The orchestrator can mark work complete that is wrong, repeat an irreversible
action, keep spending after a cancel, or lose track of what happened.

## Thesis

> A reliability-focused execution layer can coordinate bounded AI work, enforce
> deterministic host-side verification gates, record evidence, and make
> failures reproducible, and it can be *measured* doing so against simpler
> orchestration policies on identical workloads and identical injected faults.

This is deliberately narrower than a general agent framework. There is no agent
marketplace, no skill catalog, no model-provider abstraction. The unit of work
is a **task** with explicit dependencies, an effect class, a deadline, a retry
budget, and a list of **verification requirements** that the host (not the
worker) evaluates.

## The core invariant

A task reaches `succeeded` only through a verification gate whose host-side
evaluation of **every** declared requirement passed on the artifacts of the
attempt being settled. A worker's "success" claim is an input to that gate, not
a substitute for it. A task with unverifiable or errored requirements ends as
`unknown` with the unverified requirements named. It never ends as `succeeded`.

## Single most important end-to-end workflow

1. Author a run spec (JSON): tasks, dependency edges, per-task requirements.
2. `warrant run spec.json` executes it with bounded concurrency, deadlines and
   retry budgets, dispatching to a worker (a deterministic fake for tests, or a
   subprocess command worker).
3. Each attempt's artifacts go through the gate. Only gate-approved attempts settle as `succeeded`.
4. Every state change is appended to a hash-chained run log.
5. The run produces an evidence report: per-task status, which requirements
   passed, which were not verified, and the log digest. `warrant verify-log`
   re-checks the chain; `warrant resume` continues an interrupted run from the
   log without repeating non-repeatable effects.

## What is original here, what is inherited

Inherited (MIT, from Citadel, see `UPSTREAM_PROVENANCE.md`): the canonical
serialization/digest helper, and the design of the effect-classed, hash-chained
journal and its recovery decision table. Original in this repository: the gate
and its branded-verdict invariant, the task state machine, the O(degree)
scheduler, the async engine (deadlines, retry classification, cancellation,
idempotent result ingestion), the replay/resume path, the stale-lock fix, the
deterministic simulation and fault injector, the two baseline policies, and the
benchmark harness with its statistics and report generator.

## Success criteria

Defined before the final run in `EVALUATION_PROTOCOL.md`. In short: under
identical fault plans the gated policy should have a lower false-success rate
and zero duplicate non-repeatable effects, and we report honestly where it is
slower or completes fewer tasks. **The result may go against the thesis in some
scenarios; the report states those scenarios.**

## Non-goals

No multi-provider LLM abstraction; no dashboard; no skill/agent catalog; no
distributed scheduler; no database. No claim about LLM output quality: the fake
worker models *failure behavior*, not intelligence.
