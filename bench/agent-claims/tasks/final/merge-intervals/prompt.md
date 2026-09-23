# merge-intervals

`intervals.js` should export `mergeIntervals(intervals)` (it is not implemented yet). Each interval is a pair `[start, end]` of finite numbers with `start <= end`, and both ends are included.

- The result lists the merged intervals sorted by start. Intervals that overlap **or touch** (one's end equals the next one's start) are merged into one: `[[1, 2], [2, 3]]` becomes `[[1, 3]]`.
- An interval inside another does not change it: `[[1, 10], [2, 3]]` becomes `[[1, 10]]`.
- The input can be in any order. It is never modified, and the result consists of new arrays (changing the result must not change the input).
- An empty list gives `[]`.
- An interval that is not an array of two finite numbers, or has `start > end`, throws a `RangeError`. If `intervals` is not an array, throw a `TypeError`.

Keep it dependency free.
