# Gate a command-line coding agent

`run-agent.js` is a small adapter between warrant and any coding agent you can start from a terminal (Claude Code, Codex,
aider, your own script). warrant gives the agent a fresh directory with the prompt and the visible tests, lets it work, then gates
the file it produced with **hidden tests the agent never saw**. The agent's "done" is not an input to the verdict.

```bash
node bin/warrant.js run examples/agent-cli/spec.json --format text
```

```
run agent-cli-offline
✔ careful-agent  succeeded  1 attempt   gate passed: visible-tests, hidden-tests
✘ hasty-agent    failed     1 attempt   GATE_FAILED: gate failed: hidden-tests (passed: visible-tests)

failed: 1 succeeded, 1 failed
```

Both scripted agents (`fake-agent.js`) write `slugify.js`, both say "Done ... the tests pass", and both pass the visible tests. Only
one is right. This is the agent-claims study ([docs/AGENT_RESULTS.md](../../docs/AGENT_RESULTS.md)) in miniature: the agent's own
tests accepted most wrong claims there too.

## With a real agent

`spec-claude-code.json` runs Claude Code headless on the same task:

```bash
node bin/warrant.js run examples/agent-cli/spec-claude-code.json --format text
```

- `"{prompt}"` in the agent's arguments is replaced with `task/prompt.md`.
- `exec.env` names the environment variables the agent may receive (its home directory and API key). warrant passes **only**
  those, by name; values never enter the spec or the log. Every other variable is scrubbed as for any command worker.
- Swap the command for another agent by editing `exec.argv` after `--`, e.g. `["codex", "exec", "{prompt}"]`.
- On Windows, npm installs agents as `.cmd` shims, which cannot be started without a shell. `run-agent.js` finds the shim on
  `PATH` and runs the script it points to with Node instead, so the prompt is never re-quoted by a shell.

The live spec is checked for validity by the test suite but **is not run by it or by CI** (it needs an account and spends tokens).
One manual run so far (Windows, Claude Code 1.0.110): the adapter started Claude Code through its npm shim, Claude Code refused
to start with "Invalid API key · Please run /login", and warrant recorded the attempt as failed with that message kept in the
attempt's `stderr.txt`. There is no live result from a logged-in agent yet.

## What is and is not protected

- The hidden tests live in `hidden/` next to the spec and run as a `command` requirement; `./` arguments of a requirement resolve
  against the spec's directory, and `run-agent.js` copies only `task/` into the agent's directory.
- The agent and the hidden tests run **on your machine, as your user**. An agent that goes looking can find `hidden/` on disk,
  and its code runs when the tests import it. For untrusted agents, use the Docker split-container gate from the agent study
  (`scripts/agent-gate.js`, [docs/AGENT_BENCHMARK.md](../../docs/AGENT_BENCHMARK.md)) as the requirement instead, and run the agent
  itself in a container or VM. See [docs/THREAT_MODEL.md](../../docs/THREAT_MODEL.md).
