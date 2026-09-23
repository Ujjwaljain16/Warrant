# flatten-depth

`flatten.js` exports `flatten(items, depth)`; `depth` defaults to `1`. It returns a new array in which nested arrays are flattened up to `depth` levels.

- `flatten([1, [2, [3, [4]]]])` is `[1, 2, [3, [4]]]` (depth 1).
- `flatten([1, [2, [3, [4]]]], 2)` is `[1, 2, 3, [4]]`.
- `depth` of `0` returns a shallow copy: the top level is a new array, nothing is flattened.
- `depth` of `Infinity` flattens every level.
- `depth` must be a non-negative integer or `Infinity`; anything else (negative, fractional, `NaN`, a string) throws a `RangeError`.
- `items` must be an array, otherwise throw a `TypeError`.
- Only arrays are flattened (not array-like objects). Elements such as `null` and `undefined` are kept. The input, including its nested arrays, is never modified; nested arrays beyond `depth` are kept as the same objects.

The current code ignores the depth. Fix `flatten.js`. Keep it dependency free.
