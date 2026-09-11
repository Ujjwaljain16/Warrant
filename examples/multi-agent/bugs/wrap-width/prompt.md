# Fix: wrap-width (bug id: wrap-width)

`wrap(text, width)` in `wrap.js` breaks lines one character too early: `wrap('aaa bbb ccc', 7)` should be `'aaa bbb\nccc'` but every word ends up on its own line. Fix it so it word-wraps text.

Rules:

- Words are separated by any run of whitespace; the output joins words on a line with a single space and lines with `'\n'`.
- A line holds as many words as fit within `width` characters.
- A word longer than `width` goes alone on its own line, unbroken.
- No line is ever empty, and there is no leading or trailing whitespace. Text without words gives `''`.
- `width` must be an integer of at least 1, otherwise throw a `RangeError`.
- Throw a `TypeError` if `text` is not a string.

Only the file `wrap.js` is taken from your work. Keep it dependency free.
