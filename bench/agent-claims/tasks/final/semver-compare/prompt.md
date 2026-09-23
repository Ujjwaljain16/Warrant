# semver-compare

`semver.js` should export `compareSemver(a, b)` (it is not implemented yet). It compares two version strings by Semantic Versioning 2.0.0 precedence and returns `-1`, `0` or `1`.

Format: `MAJOR.MINOR.PATCH`, optionally followed by `-PRERELEASE` and/or `+BUILD`. MAJOR, MINOR and PATCH are non-negative integers without leading zeros. PRERELEASE is dot-separated identifiers of `[0-9A-Za-z-]`; numeric identifiers have no leading zeros; identifiers are never empty. BUILD is dot-separated non-empty identifiers of `[0-9A-Za-z-]`. A leading `v`, spaces, or anything else is invalid.

Precedence:

1. Compare MAJOR, then MINOR, then PATCH as numbers (they can be longer than 15 digits and must be compared exactly).
2. A version with a pre-release is lower than the same version without one: `1.0.0-alpha < 1.0.0`.
3. Two pre-releases are compared identifier by identifier from the left: numeric identifiers are compared as numbers; identifiers with letters or `-` are compared as text in ASCII order; a numeric identifier is always lower than a text one; if all shared identifiers are equal, the one with more identifiers is higher.
4. Build metadata is ignored: `1.0.0+a` and `1.0.0+b` are equal.

An invalid version string throws a `SyntaxError`; a non-string throws a `TypeError`.

Keep it dependency free.
