# grid-bfs

`gridpath.js` should export `shortestPath(grid, start, end)` (it is not implemented yet).

- `grid` is a non-empty array of strings of equal length. `'.'` is an open cell and `'#'` is a wall; no other characters occur.
- `start` and `end` are `[row, column]` pairs (row 0 is the first string).
- A move goes to the cell directly above, below, left or right (no diagonals) and only onto open cells. The result is the smallest number of moves from `start` to `end`, or `-1` if `end` cannot be reached.
- If `start` and `end` are the same open cell the result is `0`. If `start` or `end` is a wall the result is `-1`.
- A `start` or `end` that is not a pair of integers inside the grid throws a `RangeError`. A `grid` that is not a non-empty array of equal-length strings throws a `TypeError`.
- It must be fast enough for grids of 200 x 200 cells.

Keep it dependency free.
