# MCP server

`bin/warrant-mcp.js` is a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It lets Claude Code
(or any MCP client) run warrant-gated workflows and inspect their logs. The model on the other end is **untrusted**, so
the server never runs anything the model describes: it runs **specs a human put in an allowlisted directory, chosen by name**.

```
node bin/warrant-mcp.js --spec-dir <dir of approved specs> --state-dir <dir for runs and logs>
```

Zero dependencies, Node 22. Code: `src/mcp/` (protocol layer `server.js`, framing `jsonrpc.js`, tools `tools.js`, spec
allowlist `specs.js`, run manager `runs.js`, limits `limits.js`, stdio wiring `stdio.js`). Tests: `test/mcp.test.js`.

## Read this first: what the human is signing up for

**Specs in `--spec-dir` are trusted code.** Every task in a spec is a command that runs **as your user, with no sandbox**
(a scrubbed environment and a per-attempt working directory, nothing more; see `docs/THREAT_MODEL.md`, residual risks).
Anything the model can do through `warrant_run` is something you could do by running that spec yourself. So:

- only put specs in `--spec-dir` that you would run yourself, and keep the directory writable only by you;
- anyone who can write to `--spec-dir` (or to a script a spec points at) can run commands as you through the model;
- `--state-dir` is where runs are executed (each attempt's working directory is under it) and is never listed to the model.
  It grows with every run; nothing prunes it.

What the server does about the model being untrusted is the rest of this page; the short version: the model can pick a
spec **by name**, lower its concurrency, and read results. It cannot supply a path, an argv, an environment, an `exec`
command or spec text, and every failure to follow that is rejected and tested.

## Protocol revision implemented

Checked against the live specification on 2026-10-16.

| | |
|---|---|
| **Current revision, implemented** | **2026-07-28** ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) |
| Legacy revisions, implemented | 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 (the `initialize` handshake) |
| Transport | stdio ([2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)) |
| Capability | `tools` only (`{ "tools": {} }`; the tool list never changes, so no `listChanged`) |

2026-07-28 removed the `initialize` / `notifications/initialized` handshake and `ping` and made the protocol stateless, while
Claude Code's own docs say it speaks the new revision only on its v2 runtime and falls back to the handshake otherwise. So
the server is **dual-era** and decides per message:

| Message | Behaviour |
|---|---|
| `initialize` | Legacy session. Responds with the same `protocolVersion` if it is one of the four legacy revisions, else with `2025-11-25` (the client decides whether to continue). Result: `protocolVersion`, `capabilities`, `serverInfo`, `instructions`. A second `initialize` gets `-32600`. |
| `notifications/initialized` | Accepted, no response. Requests are not held back until it arrives. |
| `ping` | Legacy only (answered `{}`; also allowed before `initialize`, as the legacy lifecycle permits). Removed in 2026-07-28, so with modern `_meta` it is `-32601`. |
| `server/discover` | Modern only. `DiscoverResult` with `supportedVersions`, `capabilities`, `instructions`, `ttlMs`, `cacheScope` and `_meta["io.modelcontextprotocol/serverInfo"]`. |
| any request with `params._meta["io.modelcontextprotocol/protocolVersion"]` | Modern, stateless: needs `"2026-07-28"` and `io.modelcontextprotocol/clientCapabilities`. Wrong version: `-32022` with `data: { supported, requested }`. Missing or mistyped metadata: `-32602`. Results carry `resultType: "complete"` and the server's `_meta`. |
| request without that `_meta`, after `initialize` | Legacy semantics. |
| request without that `_meta`, no `initialize` yet | `-32602` ("send initialize first, or include `_meta`..."), except `ping`. |
| `tools/list` | One page, fixed order. `cursor` is rejected (`-32602`): we never issue one. Modern results add `ttlMs` and `cacheScope: "private"`. |
| `tools/call` | See below. `structuredContent` is sent to modern clients and to legacy clients at 2025-06-18 or later, always together with the same JSON as a text block. |
| `notifications/cancelled` | Stops a `warrant_run` that the cancelled request started, and sends no response to that request. Unknown or finished ids are ignored, as the spec allows. |

Framing and errors, as the specs require: one JSON-RPC message per line (UTF-8, `\n`-terminated, no embedded newlines);
**stdout carries protocol messages only** (diagnostics go to stderr; child processes cannot write to it because their stdio
is piped away from it); ids are strings or integers, never `null`; parse errors `-32700`, invalid requests `-32600`,
unknown methods `-32601`, bad params `-32602`, internal errors `-32603` (generic message, details on stderr).
`tools/call` follows the "two error mechanisms" rule: an unknown tool or a malformed `tools/call` is a protocol error
(`-32602`); bad *arguments* and failures such as "run in progress" are tool results with `isError: true`, so the model can
read them. Choices the specs leave open:

- A request whose id is **already in flight** is answered with an error carrying `id: null` (and ignored), so it cannot
  be mistaken for the answer to the original. The id can be reused once the original has been answered.
- JSON-RPC **batches are rejected** (`-32600`); batching was removed in 2025-06-18 (it was allowed in 2025-03-26 and
  2024-11-05, whose clients do not send it in practice).
- Not implemented (and not advertised): resources, prompts, logging, completion, subscriptions, tasks, progress,
  multi-round-trip results. A request for any of them is `-32601`.
- Closing stdin is the shutdown signal (per the stdio transport): the active run, if any, is cancelled and its process
  tree killed before the server exits. `SIGINT`/`SIGTERM` do the same.

## Tools

Each description starts with a tag, and `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`, `title`; names checked against the schema) say the same, so a client can show which tools run commands.
Annotations are hints and untrusted by definition; the enforcement is in the server, not in the annotations.

| Tool | Tag | Arguments | What it does |
|---|---|---|---|
| `warrant_list_specs` | `[READ-ONLY]` | none | Names, task counts, task ids, max concurrency and a one-line description of each approved spec. Commands are not shown. |
| `warrant_run` | **`[EXECUTES COMMANDS]`** | `spec` (name), `concurrency` (optional) | Runs the spec with the Engine, `ReceiptWorker` and `FileRunLog`, exactly as `warrant run` wires them. |
| `warrant_status` | `[READ-ONLY]` | `run_id` | `running`, `finished`, `interrupted` (the server that started it died) or `error`; per-task status derived from the hash-chained log; the last 10 log events. |
| `warrant_verify_log` | `[READ-ONLY]` | `run_id` | `readRunLogFile` (hash chain) plus `auditLog` (invariants I1-I8) against the exact spec that ran. A broken log is reported as `ok: false` with the error, not as a tool failure. |
| `warrant_get_report` | `[READ-ONLY]` | `run_id` | The engine's final report of a finished run. |

`warrant_run` waits up to `--sync-wait-ms` (default 20 s) for the run. If it is still going it returns
`state: "running"` and a `run_id`; the model then polls `warrant_status` and calls `warrant_get_report` when it has
finished. A run that *fails the gate* (`status: "failed"`) is a normal result, not a tool error: that is the product working.

The only specs a model can name are the ones `warrant_list_specs` shows. A spec has no free-text field (the validator
rejects unknown fields), so the description comes from an optional `<name>.description.txt` next to it (first line, 200
characters). See `examples/mcp/specs/`.

## Safety model

| Concern | Enforcement | Test (`test/mcp.test.js`) |
|---|---|---|
| Model picks any file | A spec is chosen **only** by a name matching `^[a-z0-9][a-z0-9-]{0,63}$`, resolved to `<spec-dir>/<name>.json`. Windows device names (`nul`, `con`, `com1`, ...) are refused too, because `nul.json` is a device there. The input schema repeats the pattern. | "names that are not plain spec names are refused" (traversal, separators, absolute and UNC paths, NUL, devices, case, Unicode look-alikes) |
| Symlinks | `lstat` refuses a symlinked spec file; the real path must equal the expected path; the file is opened with `O_NOFOLLOW` where the OS has it and its identity is re-checked after opening; the spec directory itself is resolved once at startup. Symlinks are not listed. | "a symlink in the spec dir is refused and not listed" (skipped where symlinks cannot be created) |
| Model supplies argv, env, exec commands, spec text, paths, run ids | There is no such argument. Any argument not in the tool's schema is **rejected** (not ignored, not forwarded), including `__proto__`; values are never echoed back. The run id inside a spec file is replaced by a server-generated `mcp-<12 hex>`. | "arguments that try to smuggle argv, env, exec, paths or spec content..." checks a canary file is never written and no run directory is created |
| More parallelism than approved | `concurrency` is an integer in 1..64 and is clamped to the spec's own `max_concurrency`; it can only lower it. | "concurrency can only lower the spec cap" |
| Many runs at once | One run at a time per server, claimed synchronously (no await between the check and the claim). Others get `RUN_IN_PROGRESS`. | "only one run at a time" (including two simultaneous requests) |
| A run that never ends | Hard wall-clock cap per run (`--max-run-ms`, default 10 min, at most 24 h) cancels the engine, which kills the process tree (`taskkill /T` on Windows, process group elsewhere). Per-task deadlines still apply. | "the wall-clock cap ends a run and kills the whole process tree" (a grandchild process is checked dead) |
| Run state escapes | Everything goes under `--state-dir/runs/<run_id>/`; run ids are server-generated and validated against `^mcp-[0-9a-f]{12}$` before they touch a path; state files are refused if they are symlinks, not files, or oversized. `--state-dir` may not contain or equal `--spec-dir`. Nothing is created if startup is refused. | "startup refuses ...", unknown and malformed run id cases |
| Oversized input | A request line over 128 KiB is discarded without buffering it (one `-32600` error, `id: null`) and the server carries on. | "an oversized request is refused and discarded" |
| Oversized output | Every tool result is capped at 32 KiB of text; over that it is replaced by `{ "truncated": true, "marker": "[truncated: ...]", "original_bytes", "preview" }`. Lists are bounded by construction (200 specs, 50 task ids, 50 violations, 10 events); spec files are capped at 1 MiB, logs at 16 MiB. | "a tool result larger than the limit is truncated with an explicit marker" |
| Untrusted content read as instructions | Spec descriptions, task output, log events and reports are returned as JSON **data** under named fields, stripped of control characters and length-bounded; tool descriptions and the server `instructions` say so. (A model can still be talked into things by data; this reduces the surface, it does not remove the need for a human to approve `warrant_run` calls in the client.) | "spec descriptions are cleaned data" |
| Secrets | Tasks inherit only the scrubbed environment (`PATH`, `SystemRoot`, `TEMP`...), not the server's. The server reads no keys and sends nothing over a network. | (covered by `docs/THREAT_MODEL.md` T12 and `src/util/proc.js`) |

Limits as constants: `src/mcp/limits.js`. What this does **not** give you: sandboxing of the spec's commands (run the
server in a container or VM if the specs are not yours), authentication (stdio: whoever starts the process is the client),
rate limiting beyond the one-run rule, or pruning of old runs.

## State directory

```
<state-dir>/runs/<run_id>/
  meta.json     spec name, sha256 of the spec file, requested/effective concurrency, state, termination, timestamps
  spec.json     the exact validated spec that ran (with the server-chosen run id): what warrant_verify_log audits against
  run.log       hash-chained run log (src/log/runlog.js)
  report.json   the engine's final report (absent if the run never finished)
  attempts/     per-attempt working directories of the commands
```

`termination` is `completed`, `wall_clock_cap`, `cancelled_by_client` or `error`. A human can audit a run without the
server: `node bin/warrant.js verify-log <state>/runs/<id>/run.log --spec <state>/runs/<id>/spec.json`.
The files are written by the server, but the spec's commands run as you and could rewrite them; the hash chain detects
edits to the log, not a forged-from-scratch one (same caveat as `docs/THREAT_MODEL.md`).

## Registering it in Claude Code

Syntax below is from Claude Code's MCP documentation (<https://code.claude.com/docs/en/mcp>, read 2026-10-16). Options go
**before** the server name and everything after `--` is the server command:

```bash
claude mcp add --transport stdio warrant -- node /abs/path/to/warrant/bin/warrant-mcp.js --spec-dir /abs/path/to/approved-specs --state-dir /abs/path/to/warrant-state
```

Add `--scope project` to write a shared `.mcp.json` into the project instead of your local config (`--scope user` for all
your projects); the default is `local`. The equivalent JSON forms:

```bash
claude mcp add-json warrant '{"type":"stdio","command":"node","args":["/abs/path/to/warrant/bin/warrant-mcp.js","--spec-dir","/abs/path/to/approved-specs","--state-dir","/abs/path/to/warrant-state"]}'
```

or a `.mcp.json` (see `examples/mcp/claude-code.mcp.json`):

```json
{
  "mcpServers": {
    "warrant": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/warrant/bin/warrant-mcp.js", "--spec-dir", "/abs/path/to/approved-specs", "--state-dir", "/abs/path/to/warrant-state"]
    }
  }
}
```

Use absolute paths. `claude mcp list` shows the server's health and `/mcp` inside a session shows its status. For a try-out,
point `--spec-dir` at `examples/mcp/specs` (two specs: `demo-pipeline`, `demo-lying`).

Useful client-side settings from the same page: `MCP_TOOL_TIMEOUT` (tool execution timeout) and `MAX_MCP_OUTPUT_TOKENS`
(default 25,000; this server's 32 KiB results are well under it). `MCP_PROTOCOL_NEGOTIATION=legacy` forces Claude Code onto
the `initialize` handshake if you want to exercise that path; the server speaks both. Keep Claude Code's per-tool
approval prompt on for `warrant_run`: the server limits *what* can run, the prompt is where a human decides *whether*.

**Verification status.** The Claude Code syntax is verified against its documentation only, **not** by connecting a real
Claude Code to this server: that needs a model session (network and the account's usage), which this work did not use.
(`claude mcp add --help` of the installed 1.0.110 CLI shows the older `claude mcp add [options] <name> <commandOrUrl> [args...]`
form, consistent with the `--` form above, but that build predates the 2026-07-28 revision.) What *is* verified is the
server against a scripted client for both protocol eras, below.

## Tests

```
node --test test/mcp.test.js
```

Offline and deterministic: the real server runs as a child process and is driven over stdio by a scripted JSON-RPC client,
with real `node` subprocess tasks (`examples/mcp/specs/`). Covers the full lifecycle in both eras, version negotiation,
every tool, every error path in the spec above, the security rows in the table, cancellation, the wall-clock cap with a
process-tree check, shutdown while a run is active, and that stdout is only JSON-RPC.
