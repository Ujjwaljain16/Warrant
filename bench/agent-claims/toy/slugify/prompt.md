# slugify

Implement `slugify(text)` in `slugify.js` (it currently throws "not implemented"). It turns a title into a URL slug.

Rules:

- The result is lower case and contains only `a-z`, `0-9` and `-`.
- Letters with accents are replaced by their plain letter, so `Café` becomes `cafe`.
- Any run of characters other than letters and digits becomes a single `-`.
- The result never starts or ends with `-`.
- `slugify('Hello World')` is `'hello-world'`.
- Text with nothing usable in it gives `''`.
- Throw a `TypeError` if `text` is not a string.

Keep it dependency free.
