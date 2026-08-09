# Upstream provenance

This repository starts from a small, deliberately selected subset of an
open-source project. This file records exactly what was taken, from where, and
(as the history grows) what was changed. Inherited code is not original work of
this repository.

## Source

| Field | Value |
|---|---|
| Project | Citadel |
| URL | https://github.com/SethGammon/Citadel |
| Revision imported | `16ab6ee5cd2b351eebde04585a91829a6d65f9da` (merge of PR #352, 2026-10-15) |
| Upstream version | 1.4.3 (`package.json`) |
| License | MIT, `Copyright (c) 2026 Seth Gammon` |
| License text | `third_party/citadel/LICENSE` (verbatim) |

Upstream's `.git` history is **not** carried over. A full, untouched clone of the
upstream at the revision above was kept as a separate reference checkout while
this repository was built; upstream authorship lives in the upstream repository.

## Files imported verbatim (initial import commit)

Paths are relative to the upstream root and are mirrored under `third_party/citadel/`.
SHA-256 of each file at import time:

| File | SHA-256 |
|---|---|
| `LICENSE` | `c9d5afaceca4ff60ea0073381aa89b9189be3e3821578ba49d4a8a84f53a6e10` |
| `core/operations/canonical.js` | `fa3fd8f7ec8033bb91c0acc048a2740d5ebcf1b573b95e95457f11eb53278b55` |
| `core/operations/constants.js` | `f942943d20600b3244e05221a8bef4e8a36479094db74697c054e591644d7833` |
| `core/operations/validation.js` | `b1d1093c0e98fbcc549c40ebdbf36d119bc9bf833f2c2644650087687fa26073` |
| `core/operations/journal.js` | `8d739adc3273cb383c79f9c752d0b7bf7a7704f283d5e3a8b7136270f75399a4` |
| `core/operations/recovery.js` | `bf6c50c79a9b8f23978b9e66a25b70e05fd9885d922fa615285519196638f030` |
| `scripts/operation-runner.js` | `c69336bbd5e330801a03516839936a3ebcf4a60d30b4f2b47f3a8ae3e4eebe68` |
| `scripts/test-operation-recovery.js` | `af74394b61bac7cbc53f43c49f4a4674faeb1a35628f54563d0c0e34cddd4250` |
| `scripts/test-operation-chaos.js` | `eaff38d78df11efc32d1992cfe8d10c8949e487d6673252f93ec6a4ffc389cfe` |

## Files in `third_party/citadel/` that are NOT upstream

| File | Why it exists |
|---|---|
| `core/operations/index.js` | Subset aggregator so the verbatim upstream scripts resolve `require('../core/operations')`. Upstream's own `index.js` re-exports about 20 modules this repository does not import. |

## Policy for `third_party/citadel/`

Files under `third_party/citadel/` are a pristine reference copy and are never
edited. Where this repository changes behavior, it does so in a derived file
under `src/` and records the change below, so the diff against the reference
copy is always visible.

## Material changes and new components

_Filled in as work lands. Each entry names the derived file, the upstream file
it derives from, and what changed._

