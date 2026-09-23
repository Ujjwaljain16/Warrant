# word-wrap

`wrap.js` exports `wrap(text, width)`. It breaks text into lines of at most `width` characters and returns them as an array of strings.

Rules:

- Words are runs of non-whitespace characters. Any run of whitespace (spaces, tabs, newlines) between words counts as a single space, and leading or trailing whitespace is ignored.
- Fill each line greedily: put the next word on the current line if the line, a single space and the word together are at most `width` characters; otherwise start a new line.
- A word that is longer than `width` is never split: it gets a line of its own, which may be longer than `width`.
- Lines never start or end with a space, and there are never empty lines. Text with no words gives `[]`.
- `width` must be a positive integer, otherwise throw a `RangeError`. `text` must be a string, otherwise throw a `TypeError`.

The current implementation does not follow all of this. Fix `wrap.js`. Keep it dependency free.
