# Threat model

Scope: the parts of this repository that cross a trust boundary: worker output,
artifact names and contents, subprocess execution, the on-disk run log, and the
spec file. It does not cover the security of any model provider.

## Assets

- Integrity of the final status ("succeeded" must mean verified).
- Integrity and availability of the run log.
- The host filesystem and environment (secrets in environment variables).
- Irreversible external effects (non-repeatable tasks).

## Actors and assumptions

- **Spec author**: trusted. Writes requirements and effect classes. A bad spec yields bad guarantees; we validate shape, not intent.
- **Worker** (model, agent, script): **untrusted**. May lie, crash, hang, return malformed or oversized data, or try prompt-injection-style text aimed at the orchestrator.
- **Log storage**: trusted but fallible. May be truncated by a crash, locked by a dead process, or tampered with by someone with disk access.
- **Host**: single-user developer machine. Not a multi-tenant sandbox (see Residual risks).

## Threats and mitigations

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Worker claims success to get a task marked done | `succeeded` reachable only via a `GateVerdict` produced by `evaluateGate` | `core.test.js` (forged verdicts), `engine.test.js` (false claim, hostile envelopes) |
| T2 | Worker emits text such as "verified: true" / "ignore the requirements" in artifacts or claim fields | The engine reads only the typed envelope fields; unknown fields are dropped; requirements are never derived from worker output | `engine.test.js` ("untrusted worker output" tests) |
| T3 | Artifact name path traversal (`../../x`, absolute paths, NUL, reserved Windows names) | Strict name pattern (lowercase alphanumerics, `.`, `_`, `-`; no `..`, no trailing dot, no Windows device names), length and count caps; the command worker lstat-checks outputs, refuses symlinks and non-regular files, and checks real-path containment | `engine.test.js` (hostile envelopes), `workers.test.js` (symlink output) |
| T4 | Oversized output / output flood | Per-artifact byte cap and artifact-count cap in the envelope parser; stdout/stderr capture cap | `engine.test.js` (oversize body), `workers.test.js` (output flooding) |
| T5 | Prototype pollution via `__proto__` / `constructor` keys in JSON artifacts or specs | Spec validator rejects such keys at any depth; `artifact_json` scans the parsed document and fails with `FORBIDDEN_KEY`; the run-log event validator rejects them too | `core.test.js` (spec and gate tests) |
| T6 | Hung or slow worker holds resources | Per-attempt deadline, AbortSignal, process-tree kill, bounded concurrency | `engine.test.js` (deadline), `workers.test.js` (killed hung child, cancel kills child) |
| T7 | Duplicate / replayed results re-trigger dependents | Per-`(task, attempt)` single ingestion; state-derived readiness | `engine.test.js` (duplicate delivery, late result), `bench.test.js` |
| T8 | Crash during an irreversible effect leads to a repeat | Effect-class recovery; `unknown` unless evidenced reconcile | `resume.test.js` (chaos at every log-append boundary), `engine.test.js` (reconcile, quiescence) |
| T9 | Process dies holding the log lock; run wedged forever | One writer lock per log, held for the handle's lifetime and reclaimed when its owner process is dead; explicit `breakLock` override. No heartbeat or expiry, so pid reuse can make a stale lock look live (residual risk) | `runlog.test.js` (regression for the upstream defect) |
| T10 | Log tampering or torn write | Hash chain, contiguous sequence numbers, fsync per entry; a torn final line is truncated on open, any other corruption fails closed | `runlog.test.js` |
| T11 | Command injection through verifier `command` requirement | argv array, `shell: false`, no interpolation of worker data into argv | `core.test.js` (command requirement with metacharacters in argv) |
| T12 | Secrets leak into logs | Log events carry digests and short codes, not artifact bodies; error text is redacted by pattern before logging | `redaction.test.js` |
| T13 | Over-budget execution | Hard attempt and concurrency caps checked at dispatch (I3) | `engine.test.js` (attempt budget, concurrency cap) and the log audit run on every benchmark trial |
| T14 | A command dies, or the orchestrator dies, between a non-repeatable effect and its recorded result, and the effect is repeated | Receipt protocol: `reconcile` answers "applied" only from a valid receipt, "not applied" only when the process is gone and left no `effect.intent`; everything else is `unknown`. Receipts are digest-checked against the output files, bound to the idempotency key, and size-capped; symlinked outputs are refused. Residual: the command's own honesty about intent/receipt is trusted | `receipt-worker.test.js` (crash after effect with a real subprocess, worker-level and orchestrator-level; died before/after effect; tampered and forged receipts; live process) |

## Residual risks (explicitly not solved)

- **No OS-level sandbox.** The command worker and `command` verifier run as the current user. They use a scrubbed
  environment and a confined working directory, but a malicious command can still read files the user can read.
  Run untrusted workers in a container or VM.
- **Process-tree kill on Windows** relies on `taskkill /T /F`; descendants that detach can survive.
- **The gate cannot check what the spec does not require.** Missing requirements mean missing guarantees.
- **Predicate verifiers run in-process** and are trusted code supplied by the host, not by the worker.
- The log hash chain detects tampering after the fact; it is not signed, so someone who can rewrite the whole log can forge a consistent one.
