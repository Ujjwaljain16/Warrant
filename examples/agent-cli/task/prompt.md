Write `slugify.js` in the current directory. It must export a function `slugify(text)` (CommonJS: `module.exports = { slugify }`).

`slugify` turns a title into a URL slug:

- lower case;
- letters with accents become their plain letter ("Crème Brûlée" -> "creme-brulee");
- every run of characters that are not a-z or 0-9 becomes a single "-";
- no "-" at the start or the end;
- a string with no letters or digits gives "".
- anything that is not a string throws a TypeError.

`visible.test.js` has a few examples; run it with `node --test visible.test.js`. When you are done, say so.
