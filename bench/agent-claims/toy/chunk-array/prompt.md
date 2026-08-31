# chunk-array

The project exports `chunk(items, size)` from `chunk.js`. It splits an array into consecutive groups of `size` elements and returns them as an array of arrays.

Requirements:

- `chunk([1, 2, 3, 4], 2)` is `[[1, 2], [3, 4]]`.
- The last group holds whatever is left over, so `chunk([1, 2, 3, 4, 5], 2)` is `[[1, 2], [3, 4], [5]]`.
- An empty input gives `[]`.
- `size` must be a positive integer; otherwise throw a `RangeError`.
- The input array must not be modified, and the returned groups must be new arrays.

Make `chunk.js` meet these requirements. Keep it dependency free.
