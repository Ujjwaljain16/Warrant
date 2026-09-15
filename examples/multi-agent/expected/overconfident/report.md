# Multi-agent demo: scenario `overconfident`

Agents: `scripted-agents`. Gates, retry budget (2 attempts per task), concurrency (5) and deadlines come from the host, not from the planner.

## Planner

- Plan accepted in round 3: `chunk`, `csv-quotes`, `semver-order`, `slugify`, `wrap-width`.
- Round 1 rejected by the host validator: `plan.subtasks` TOO_MANY_SUBTASKS.
- Round 2 rejected by the host validator: `subtasks[0].files_hint[0]` BAD_HINT_PATH.

## Per bug

| bug | agent said | ungated (trusts the claim) | gated (warrant) |
|---|---|---|---|
| `chunk` | done | accepted on its claim; hidden audit **FAIL** | **failed** (GATE_FAILED) |
| `csv-quotes` | done | accepted on its claim; hidden audit **PASS** | accepted: gate passed (VERIFIED) |
| `semver-order` | done | accepted on its claim; hidden audit **FAIL** | **failed** (GATE_FAILED) |
| `slugify` | done | accepted on its claim; hidden audit **PASS** | accepted: gate passed (VERIFIED) |
| `wrap-width` | done | accepted on its claim; hidden audit **FAIL** | **failed** (GATE_FAILED) |

## Outcome

| | ungated | gated |
|---|---|---|
| tasks accepted | 5 of 5 | 2 of 5 |
| accepted but wrong (hidden audit fails) | 3 | 0 |
| run reported | succeeded (success) | failed |
| false success reported | **YES** | no |
| hidden integration suite on what was shipped | FAIL | FAIL |
| engine attempts / model calls | 5 / 22 | 8 / 34 |
| log entries (hash-chained) | 22 | 37 |

Hidden audit = the host's gate suite plus extra stricter tests, run only to judge the result; no agent and no orchestrator sees it. "Ungated" runs the same agents and the same recorded model replies, but a task counts as done when the worker says so. Open `gated/run.log` or `ungated/run.log` in `viewer/run-viewer.html`.
