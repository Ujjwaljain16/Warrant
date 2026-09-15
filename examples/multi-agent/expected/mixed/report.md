# Multi-agent demo: scenario `mixed`

Agents: `scripted-agents`. Gates, retry budget (2 attempts per task), concurrency (5) and deadlines come from the host, not from the planner.

## Planner

- Plan accepted in round 2: `chunk`, `csv-quotes`, `semver-order`, `slugify`, `wrap-width`.
- Round 1 rejected by the host validator: `plan.requirements` UNKNOWN_FIELD, `plan.max_concurrency` UNKNOWN_FIELD, `subtasks[0].exec` UNKNOWN_FIELD, `subtasks[1].exec` UNKNOWN_FIELD, `subtasks[2].exec` UNKNOWN_FIELD, `subtasks[3].exec` UNKNOWN_FIELD, ....

## Per bug

| bug | agent said | ungated (trusts the claim) | gated (warrant) |
|---|---|---|---|
| `chunk` | done | accepted on its claim; hidden audit **PASS** | accepted: gate passed (VERIFIED) |
| `csv-quotes` | done | accepted on its claim; hidden audit **FAIL** | **failed** (GATE_FAILED) |
| `semver-order` | cannot | not accepted (AGENT_CANNOT) | **failed** (AGENT_CANNOT) |
| `slugify` | done | accepted on its claim; hidden audit **PASS** | accepted: gate passed (VERIFIED) |
| `wrap-width` | no claim (max_steps) | not accepted (MAX_STEPS) | **failed** (MAX_STEPS) |

## Outcome

| | ungated | gated |
|---|---|---|
| tasks accepted | 3 of 5 | 2 of 5 |
| accepted but wrong (hidden audit fails) | 1 | 0 |
| run reported | failed | failed |
| false success reported | no | no |
| hidden integration suite on what was shipped | FAIL | FAIL |
| engine attempts / model calls | 5 / 31 | 6 / 36 |
| log entries (hash-chained) | 22 | 27 |

Hidden audit = the host's gate suite plus extra stricter tests, run only to judge the result; no agent and no orchestrator sees it. "Ungated" runs the same agents and the same recorded model replies, but a task counts as done when the worker says so. Open `gated/run.log` or `ungated/run.log` in `viewer/run-viewer.html`.
