# edit-distance

`editdistance.js` should export `editDistance(a, b)` (it is not implemented yet). It returns the minimum number of edits that turn string `a` into string `b`.

An edit is one of:

- inserting one character,
- deleting one character,
- replacing one character with another,
- swapping two adjacent characters (a transposition).

Each edit costs 1. This is the "optimal string alignment" distance: no substring may be edited more than once, so `editDistance('ca', 'abc')` is `3` (not `2`).

Characters are compared as UTF-16 code units, exactly as JavaScript indexes a string. Both arguments must be strings, otherwise throw a `TypeError`.

Examples: `editDistance('kitten', 'sitting')` is `3`; `editDistance('', 'abc')` is `3`; `editDistance('same', 'same')` is `0`.

Keep it dependency free.
