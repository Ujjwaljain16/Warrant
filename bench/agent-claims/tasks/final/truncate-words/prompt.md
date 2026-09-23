# truncate-words

`truncate.js` should export `truncate(text, max, ellipsis)` (it is not implemented yet). `ellipsis` defaults to `'…'` (one character).

Rules:

- If `text.length <= max` the text is returned unchanged.
- Otherwise the result is a prefix of the text followed directly by `ellipsis`, and the whole result is at most `max` characters long (the ellipsis counts).
- The prefix ends at the end of a word: it is the longest prefix that ends immediately before a whitespace character that follows a non-whitespace character, and whose length plus the ellipsis length is at most `max`. Whitespace of any kind (spaces, tabs, newlines) is a boundary.
- If no such prefix exists, cut hard: the result is the first `max - ellipsis.length` characters of the text followed by the ellipsis.
- `max` must be an integer that is at least `ellipsis.length`, otherwise throw a `RangeError`. `text` and `ellipsis` must be strings, otherwise throw a `TypeError`.
- Lengths are JavaScript string lengths (UTF-16 code units).

Example: `truncate('the quick brown fox', 12)` is `'the quick…'`.

Keep it dependency free.
