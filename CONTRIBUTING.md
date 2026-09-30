# Contributing

This is a small, zero-dependency Node 22 project. Before sending a change:

```bash
npm run check    # syntax, hygiene, secret scan, vendored-file hashes, documentation links and pinned numbers
npm test         # the Docker-dependent tests skip with a reason when Docker is absent
```

Rules that keep the claims honest:

- `third_party/` is vendored verbatim and hash-checked; do not edit it.
- Documentation states only what a command in the repository reproduces. Numbers quoted in the README and docs are generated from
  `results/*/summary.json`; `npm run check:docs` fails when they drift.
- `docs/AGENT_CLAIMS_PROTOCOL.md` is frozen once a held-out run has started; changes go in its Amendments section.
- Results directories carry a `meta.json` with provenance; do not hand-edit them.
