# rotate-array

`rotate.js` should export `rotate(items, k)` (it is not implemented yet). It returns a new array with the items rotated to the right by `k` positions: the last `k` items move to the front.

- `rotate([1, 2, 3, 4, 5], 2)` is `[4, 5, 1, 2, 3]`.
- A negative `k` rotates to the left: `rotate([1, 2, 3, 4, 5], -1)` is `[2, 3, 4, 5, 1]`.
- `k` may be larger than the array length (rotating by the length changes nothing).
- `k` of `0`, an empty array or a single item all work; the result is always a new array.
- `k` must be an integer, otherwise throw a `RangeError`. `items` must be an array, otherwise throw a `TypeError`.
- The input array is never modified.

Keep it dependency free.
