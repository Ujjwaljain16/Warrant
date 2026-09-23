# spiral-matrix

`spiral.js` exports `spiral(matrix)`. It returns the elements of a rectangular matrix (an array of rows) in clockwise spiral order, starting at the top-left element: first along the top row to the right, then down the last column, then along the bottom row to the left, then up the first column, then the same again for the inside.

Examples: `spiral([[1, 2, 3], [4, 5, 6], [7, 8, 9]])` is `[1, 2, 3, 6, 9, 8, 7, 4, 5]`; `spiral([[1, 2, 3, 4]])` is `[1, 2, 3, 4]`; `spiral([[1], [2], [3]])` is `[1, 2, 3]`.

- Every element appears exactly once. The matrix may have any number of rows and columns, including a single row or column.
- `[]` and `[[]]` give `[]`.
- All rows must be arrays of the same length, otherwise throw a `TypeError`; so must `matrix` itself be an array.
- The input is never modified.

The current code works for some inputs and not others. Fix `spiral.js`. Keep it dependency free.
