# unique-by

`uniqueby.js` should export `uniqueBy(items, keyFn)` (it is not implemented yet). It returns a new array with the first item for each distinct key, in the original order.

Requirements:

- `keyFn` is optional; without it each item is its own key. When given, it is called exactly once per item, as `keyFn(item, index)`, in order.
- Keys are compared with the same equality as `Set` and `Map` (so `NaN` equals `NaN`, `0` equals `-0`, objects are equal only to themselves).
- `uniqueBy([1, 2, 1, 3, 2])` is `[1, 2, 3]`; `uniqueBy([{id: 1, v: 'a'}, {id: 1, v: 'b'}], (o) => o.id)` keeps only the first object.
- `items` must be an array and `keyFn`, when provided, a function; otherwise throw a `TypeError`.
- The input is never modified.

Keep it dependency free.
