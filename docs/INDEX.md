# Documentation index

A suggested reading order. Each page says what it claims and what it does not.

## Start here

1. [README](../README.md): the pitch, the two headline results, a five-minute tour.
2. [OVERVIEW](OVERVIEW.md): every capability with its status, the layout, the limitations.
3. [PROJECT_THESIS](PROJECT_THESIS.md): the problem, the claim, the non-goals, what is original.

## The engine

- [ARCHITECTURE](ARCHITECTURE.md): modules, state machine, invariants I1-I8, recovery and receipt-based reconcile.
- [DECISIONS](DECISIONS.md): design decisions, each with the evidence behind it.
- [THREAT_MODEL](THREAT_MODEL.md): trust boundaries, mitigations with the test for each, residual risks.
- [PERFORMANCE](PERFORMANCE.md): the two optimizations kept, the one rejected, how they were measured.

## The evidence

- [BENCHMARK](BENCHMARK.md) and [EVALUATION_PROTOCOL](EVALUATION_PROTOCOL.md): the simulated benchmark and the partial-requirements experiment.
- [AGENT_CLAIMS_PROTOCOL](AGENT_CLAIMS_PROTOCOL.md): the real-model study, fixed before it ran.
- [AGENT_RESULTS](AGENT_RESULTS.md): what the study found, what limits it, and where it deviated from the protocol.
- [AGENT_BENCHMARK](AGENT_BENCHMARK.md) and [ROUTER](ROUTER.md): the harness design, the sandbox, the router arm and its spend cap.

## Tools built on the engine

- [MCP](MCP.md): the MCP server and its safety model.
- [VIEWER](VIEWER.md): the offline run viewer.
- [MULTI_AGENT_DEMO](MULTI_AGENT_DEMO.md): planner plus parallel workers, gated vs ungated.

## Provenance and audit

- [UPSTREAM_PROVENANCE](UPSTREAM_PROVENANCE.md): exactly what was taken from Citadel and what changed.
- [AUDIT](AUDIT.md): the upstream audit and its findings.
- [FINAL_AUDIT](FINAL_AUDIT.md): the project audit: what was tested, what is verified, what is not done.
