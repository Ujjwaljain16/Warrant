# Fix: chunk (bug id: chunk)

`chunk(items, size)` in `chunk.js` drops the last, shorter piece: `chunk([1, 2, 3, 4, 5], 2)` returns `[[1, 2], [3, 4]]`. Fix it.

Rules:

- The pieces are consecutive, in order, each with `size` items except possibly the last, which may be shorter.
- An empty array gives `[]`.
- The input array is never modified, and the pieces are new arrays.
- `size` must be an integer of at least 1, otherwise throw a `RangeError`.
- Throw a `TypeError` if `items` is not an array.

Only the file `chunk.js` is taken from your work. Keep it dependency free.
