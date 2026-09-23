# bounds

`bounds.js` exports `lowerBound(sorted, x)` and `upperBound(sorted, x)` for an array of numbers sorted in ascending order (duplicates are allowed).

- `lowerBound` returns the first index `i` such that `sorted[i] >= x`, or `sorted.length` if there is none.
- `upperBound` returns the first index `i` such that `sorted[i] > x`, or `sorted.length` if there is none.
- So `upperBound - lowerBound` is the number of elements equal to `x`.
- Both must run in O(log n) time: on a sorted array of a million elements they may read at most 64 elements.
- `sorted` must be an array and `x` a number that is not `NaN`; otherwise throw a `TypeError`.
- The input is never modified.

The current code is wrong in some cases. Fix `bounds.js`. Keep it dependency free.
