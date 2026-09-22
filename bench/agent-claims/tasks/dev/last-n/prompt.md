# last-n

`lastn.js` should export `lastN(items, n)`, which returns a new array holding the last `n` elements of `items` in their original order. It is not implemented yet.

Requirements:

- `lastN([1, 2, 3, 4], 2)` is `[3, 4]`.
- If `n` is larger than the number of items, the result is a copy of the whole array.
- `n` of `0` gives `[]`.
- `n` must be a non-negative integer; anything else (negative, fractional, `NaN`, `Infinity`, a string, `undefined`) throws a `RangeError`.
- `items` must be an array, otherwise throw a `TypeError`.
- The input array is never modified.

Make `lastn.js` meet these requirements. Keep it dependency free.
