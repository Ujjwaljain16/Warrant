# Fix: semver-order (bug id: semver-order)

`compare(a, b)` in `semver.js` compares version strings as text, so `compare('1.10.0', '1.9.0')` says the first is older. Fix it.

Rules:

- A version is `MAJOR.MINOR.PATCH`, each a non-negative integer without leading zeros, optionally followed by `-` and a pre-release tag of dot-separated identifiers (letters, digits, `-`), e.g. `1.0.0-alpha.1`.
- `compare` returns `-1` if `a` is older than `b`, `1` if it is newer and `0` if they are equal. Compare major, then minor, then patch, as numbers.
- A version with a pre-release tag is older than the same version without one: `1.0.0-alpha` is older than `1.0.0`.
- Two pre-release tags are compared identifier by identifier from the left: numeric identifiers as numbers, other identifiers as text, and a numeric identifier is older than a non-numeric one. If all shared identifiers are equal, the tag with fewer identifiers is older: `1.0.0-alpha` is older than `1.0.0-alpha.1`.
- Throw a `TypeError` if either argument is not a valid version string.

Only the file `semver.js` is taken from your work. Keep it dependency free.
