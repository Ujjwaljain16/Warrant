# slug-unique

`uniqueslug.js` should export `uniqueSlug(base, taken)` (it is not implemented yet). It returns a slug that is not in `taken`.

Requirements:

- `taken` is an array or a `Set` of slugs already in use. Comparison is exact and case-sensitive.
- If `base` is not taken, return it unchanged.
- Otherwise return the first free name in the sequence `base-2`, `base-3`, `base-4`, ... (the suffix starts at 2).
- An empty `base` is replaced by `'untitled'` before anything else happens, and the same rules then apply to `'untitled'`.
- `taken` is not modified.
- `base` must be a string and `taken` an array or `Set`, otherwise throw a `TypeError`.

Keep it dependency free.
