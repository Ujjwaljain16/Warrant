# Open issues

Five independent bugs in `textkit`. Each one lives in its own module and can be fixed without touching the others.

## slugify: punctuation survives in slugs
`slugify('Hello, World!')` returns `hello,-world!`. Slugs should only contain lower-case letters, digits and dashes.
Module: `slug.js`.

## chunk: the last short piece is lost
`chunk([1, 2, 3, 4, 5], 2)` returns `[[1, 2], [3, 4]]`; the `5` disappears. Module: `chunk.js`.

## csv-quotes: quoted fields are split on their commas
`parseLine('a,"b,c",d')` returns four fields instead of three. Module: `csv.js`.

## semver-order: versions are compared as text
`compare('1.10.0', '1.9.0')` says `1.10.0` is older. Module: `semver.js`.

## wrap-width: lines break one character early
`wrap('aaa bbb ccc', 7)` puts every word on its own line although `aaa bbb` fits in 7 characters. Module: `wrap.js`.
