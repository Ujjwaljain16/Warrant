# bracket-validator

`brackets.js` should export `checkBrackets(text)` (it is not implemented yet). It checks that the brackets `()`, `[]` and `{}` in a piece of source text are balanced and properly nested, and returns an object.

Text is scanned from left to right. The following are **not** scanned for brackets:

- String literals: `'...'` or `"..."`. Inside a string a backslash escapes the next character (so `\"` does not end a double-quoted string). A string may not contain a line break.
- Line comments: `//` up to the end of the line (a `//` inside a string is just text).
- Block comments: `/* ... */`, which may span lines.

Result:

- `{ ok: true }` if everything is fine.
- Otherwise `{ ok: false, reason, index }` for the **first** problem found while scanning left to right, where `index` is a zero-based position in `text`:
  - `'unexpected-closer'`: a closing bracket when no bracket is open; `index` is the closing bracket.
  - `'mismatch'`: a closing bracket that does not match the innermost open bracket; `index` is the closing bracket.
  - `'unterminated-string'`: a string still open at a line break or at the end of the text; `index` is its opening quote.
  - `'unterminated-comment'`: a block comment never closed; `index` is the `/` that opened it.
  - `'unclosed'`: after scanning everything, brackets are still open; `index` is the innermost (most recently opened) one.
- A non-string throws a `TypeError`.

Keep it dependency free.
