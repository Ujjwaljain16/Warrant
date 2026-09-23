# isbn10

`isbn.js` should export `isValidIsbn10(text)` (it is not implemented yet). It returns `true` or `false`.

Rules:

- Hyphens and spaces may appear anywhere and are ignored.
- What remains must be exactly ten characters: nine digits followed by a check character, which is a digit or the letter `X` (a lower-case `x` is accepted too). `X` is only allowed as the last character.
- The check: give the ten characters weights 10, 9, 8, ..., 1 (first to last). `X` has the value 10. The ISBN is valid when the weighted sum is divisible by 11.
- Anything that does not satisfy these rules returns `false` (no exception), except that a non-string throws a `TypeError`.

Examples: `'0-306-40615-2'` is valid; `'0306406153'` is not.

Keep it dependency free.
