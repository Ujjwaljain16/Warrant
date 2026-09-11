# Fix: slugify (bug id: slugify)

`slugify(text)` in `slug.js` returns `hello,-world!` for `'Hello, World!'`. Fix it so it turns a title into a URL slug.

Rules:

- The result is lower case and contains only `a-z`, `0-9` and `-`.
- Letters with accents are replaced by their plain letter, so `Café` becomes `cafe`.
- Any run of characters other than letters and digits becomes a single `-`.
- The result never starts or ends with `-`.
- Text with nothing usable in it gives `''`.
- Throw a `TypeError` if `text` is not a string.

Only the file `slug.js` is taken from your work. Keep it dependency free.
