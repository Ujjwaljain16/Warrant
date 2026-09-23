# query-string

`query.js` should export `parseQuery(str)` (it is not implemented yet). It parses a URL query string into an object.

Rules:

- One leading `?` is ignored.
- The string is split at `&`. Empty segments are skipped (`a=1&&b=2` has two pairs).
- Each segment is split at its **first** `=` into key and value. A segment without `=` has the value `''`; `a=` also has the value `''`; `a=b=c` has the value `'b=c'`. A segment whose key is empty (such as `=x`) is skipped.
- Keys and values are decoded the same way: every `+` becomes a space, and every `%XX` (two hex digits, any case) is a byte of UTF-8 text. Consecutive `%XX` escapes are decoded together as UTF-8 (`%E2%82%AC` is `€`); bytes that are not valid UTF-8 become U+FFFD. A `%` that is not followed by two hex digits (`%zz`, `%4`, a final `%`) is kept as the literal text, and it does not affect the other escapes around it. `%2B` is a literal `+` (it is not turned into a space).
- A key that occurs once has a string value. A key that occurs several times has an array of all its values, in order of appearance.
- The result is an object created with `Object.create(null)`, so keys such as `__proto__` and `constructor` are ordinary keys. Keys keep the order in which they first appear.
- A non-string argument throws a `TypeError`.

Keep it dependency free.
