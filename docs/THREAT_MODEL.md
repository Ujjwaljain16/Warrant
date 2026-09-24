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
| T15 | Model-written code (an agent episode) runs on the host | Only in a Docker container: no network, read-only root, writable `/work` and `/tmp` only, 256 MB, 1 CPU, 128 pids, unprivileged user, all capabilities dropped, `no-new-privileges`, init process, 16 MiB file size and 512 open-file limits; timeout, abort and output overflow remove the container by name. No model-written code runs outside it | `sandbox.test.js` (no network, read-only root, limits, kill on timeout/abort; skipped with a reason when Docker is absent) |
| T16 | Prompt injection through repository files or test output read by the agent | Tool results are delivered as labelled, fenced data; the action set, workspace root and step budget are enforced by code, not by the prompt; the gate re-runs hidden tests on the pristine repository plus only the declared outputs, so editing tests or adding files cannot pass it (T18 for what the code itself can do); workspace path names are checked against Windows aliases (`GIT~1`, `::$DATA`, trailing dots and spaces) as well as `..`, drives and links | `agent.test.js` (injection file, escaping paths, extra fields, rigged tests, NTFS aliases) |
| T17 | An API key or prompts leak through cassettes, transcripts or logs; free-tier prompts are used by the provider | The key is read only by `src/llm`, sent only in a header and scrubbed from errors; cassettes keep key hashes and responses; only synthetic tasks are ever sent (the free tier may train on prompts) | `llm.test.js` (no key or header in cassettes or errors); the task checker scans every task file for key-shaped strings and the configured key |
| T18 | The agent's code is judged in the process that runs it, so it can pass without being correct (`process.exit(0)`, patched `assert`, forged TAP, reading the hidden tests) | **Split gate** (`src/agent/gate.js`, `src/gate/`): the code under test lives in its own container; the hidden tests, `node:test` and `assert` run unmodified in a second container where `require('./solution')` is a proxy of the first. The two containers talk over a TCP connection on a loopback they share (the verdict container joins the solution container's network namespace, which has no other network) and the host is not in the data path. The verdict is printed by the verdict container with a per-run nonce; the solution's output is never parsed for a decision. Hidden tests exist only in the verdict container; an early exit of the solution is a failure, never a vacuous pass; the exact set of tests is pinned (`gate-manifest.json`); the verdict container refuses to export its own built-ins (`Function`, `Object.prototype`, native functions) so the proxy can not be used to run code there | `gate.test.js` (membrane semantics, hostile peer, strict verdict reading), `gate-adversarial.test.js` (24 attacks through the real gate; before the change 6 of them passed on a solution that implements nothing), `agent-task-check.js --run` (all 43 tasks: reference passes, start and naive fail, deterministic, pins match) |
| T19 | An accepted artifact is changed after the gate saw it, and a downstream task consumes the changed bytes | The engine keeps the verified bytes of every accepted task and the command worker gives each dependent a private, read-only copy of exactly those bytes (`dep_dirs`); after a resume, when the bytes are not in memory, they are re-read from the finished attempt and checked against the digest in the log (`DEP_CHANGED` / `DEP_MISSING` fail the task). A process the producer left running can still rewrite the producer's own directory; nothing reads it | `workers.test.js` (lingering writer; digest check after resume) |
| T20 | A forged or incomplete log passes the invariant audit | `auditLog` (one implementation in `src/engine/audit-core.js`, used by the engine, the MCP verify tool and the viewer bundle) also requires: every attempt event belongs to a started attempt of that task; a success rests on a claimed result and a passing verdict about the same digest (or a reconcile that found the effect applied); one `run_started` (more only when resumed) with the digest of the spec; `run_finished` last, with the status and counts the tasks imply (blocked tasks derived from the dependency graph) | `viewer.test.js` (12 forged logs with valid chains, engine/viewer parity), `mcp.test.js` (forged log through `warrant_verify_log`) |
| T21 | A sandboxed run exhausts or reaches the host (disk, inodes, memory, the host path in `/proc/self/mountinfo`, a container left running after a hard kill) | Agent and gate containers get their files by copy into a size- and inode-limited tmpfs; no host directory is mounted, so nothing a container writes reaches the host and no host path is visible inside; a 16 MiB per-file limit; host reads of workspace files are size-capped; an in-container deadline ends a container even if the orchestrator died; containers carry a label and the benchmark removes stale ones at start-up; the image id and repository digest are recorded and the image can be pinned (`WARRANT_SANDBOX_IMAGE`) | `sandbox.test.js` (300 MB writer, 20 000 files, mountinfo, deadline without the host, sweep), `agent.test.js` (huge-file read) |

## Residual risks (explicitly not solved)

- **Memorised answers (T18).** The split gate keeps the code under test from changing the verdict; it can not tell a table of memorised answers from an
  algorithm. It never sees the tests, so only a model that already knows them can do this, and a model that has seen this repository could. The
  corpus includes this case on purpose (`RESIDUAL`) and expects it to pass. The gate runs once per episode with no agent present and its output
  goes nowhere the agent can read, so there is no oracle to probe across runs; within one run a solution sees the inputs the tests send (and
  which calls follow), but never an expected value, so it can learn how the tests exercise it but not what they accept.
- **Fidelity of the proxy.** A test written for one process sees the solution through a proxy. Everything the 43 suites use behaves identically
  (checked by running them, and by differential runs of mutants of the reference solutions through the old in-process gate and the new one). Known
  differences: `Map`, `Set`, `Date`, `RegExp`, `Error` and typed arrays cross by value (a solution that mutates a `Map` argument is not seen
  by the test); stack traces and `Function.prototype.toString` of proxied functions differ; objects that are exotic (revocable proxies, `WeakRef`)
  are not supported; native functions and the verdict side's built-ins can not be passed to the solution except a short list of pure ones
  (`Math.*`, `String`, `Number`, ...), and a test that does so fails instead of passing; tests that depend on timing see about half a millisecond
  of latency per call (the task checker runs every suite twice and requires identical results; a heavily loaded host would add to it).
- **The membrane is code, and the verdict side parses what the solution sends.** It is JSON only, never evaluated, and every operation that
  reaches back into the verdict process is limited to objects the test itself passed over; a bug there would be a bug in the judge. It is covered
  by the hostile-peer test and the corpus, not proven.
- **The two gate containers share a network namespace** (loopback only), so the solution can see and talk to the verdict side's connection; it can do nothing there that it can not already do through the protocol (the listener accepts exactly one connection, made before any solution code runs), and nothing else is reachable. They do not share processes, files or memory.
- **Containers share a kernel and a Docker daemon.** A runtime or kernel escape defeats every claim here. A noisy solution can slow the host's
  Docker; the gate uses at most two containers at a time.

- **No OS-level sandbox.** The command worker and `command` verifier run as the current user. They use a scrubbed
  environment and a confined working directory, but a malicious command can still read files the user can read.
  Run untrusted workers in a container or VM.
- **The Docker sandbox for agent code (T15, T18, T21) is defence in depth, not a hardened boundary** against a kernel or runtime escape. It is
  used for synthetic, low-stakes tasks only. The image is a moving tag unless pinned; its digest is recorded with every benchmark run.
- **Process-tree kill on Windows** relies on `taskkill /T /F`; descendants that detach can survive.
- **The gate cannot check what the spec does not require.** Missing requirements mean missing guarantees.
- **Predicate verifiers run in-process** and are trusted code supplied by the host, not by the worker.
- The log hash chain detects tampering after the fact; it is not signed, so someone who can rewrite the whole log can forge a consistent one. The invariant audit (T20) is the second line: it catches a forgery that tells an impossible story, not one that is internally coherent (a consistent log of events that never happened).
- **Receipts (T14)** still trust the command: it can write a false receipt, or an intent file late. The host's own record of an attempt now lives next to the attempt directory instead of inside it, and receipt digests bind the bytes of an output (a non-UTF-8 output is refused by name), but a command that goes looking for that sibling file can still write to it. A hostile state directory owner is out of scope.
- **Unreproduced.** Real Linux/macOS behaviour of the sandbox (uid mapping with Docker bind mounts is no longer relevant: nothing is mounted) and the POSIX temp-directory permission fix (the workspaces are no longer made world-writable; verified on Windows only).
