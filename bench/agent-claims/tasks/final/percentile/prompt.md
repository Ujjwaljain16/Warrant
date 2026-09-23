# percentile

`percentile.js` should export `percentile(values, p)` (it is not implemented yet). It returns the `p`-th percentile of an array of numbers using linear interpolation between the closest ranks:

1. sort the values in ascending numeric order,
2. let `rank = p / 100 * (n - 1)` where `n` is the number of values (rank 0 is the smallest value),
3. if `rank` falls between two positions, interpolate linearly between the two values on either side of it.

Examples: `percentile([1, 2, 3, 4], 50)` is `2.5`; `percentile([1, 2, 3, 4], 0)` is `1`; `percentile([1, 2, 3, 4], 100)` is `4`.

- `p` must be a number from 0 to 100 inclusive, otherwise throw a `RangeError`.
- `values` must be a non-empty array, otherwise throw a `RangeError`; every value must be a finite number, otherwise throw a `TypeError`.
- The input array is never modified.

Keep it dependency free.
