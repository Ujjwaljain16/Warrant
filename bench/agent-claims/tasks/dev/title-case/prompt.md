# title-case

`titlecase.js` should export `titleCase(text)` (it is not implemented yet).

Rules:

- Words are separated by whitespace. The original whitespace between and around words is kept exactly as it was (multiple spaces, tabs and newlines included).
- In each word the first character is upper-cased and all other characters are lower-cased: `hELLO` becomes `Hello`.
- These small words stay entirely lower-case: `a an and as at but by for in of on or the to`. The exception: the first word and the last word of the text are always capitalized.
- A word containing hyphens is capitalized part by part, and the small-word rule does not apply to its parts: `well-known` becomes `Well-Known`, `mother-in-law` becomes `Mother-In-Law`.
- An apostrophe does not start a new word part: `don't` becomes `Don't`.
- Whether a word is small is decided on the whole word, ignoring case (`OF` in the middle of a text becomes `of`).
- An empty string gives an empty string. A non-string throws a `TypeError`.

Keep it dependency free.
