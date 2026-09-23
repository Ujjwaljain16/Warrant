# top-k-frequent

`topk.js` should export `topK(items, k)` (it is not implemented yet). `items` is an array of strings. It returns the `k` most frequent distinct strings.

- Order the result by count, highest first. Strings with the same count are ordered alphabetically, comparing with `<` (UTF-16 code unit order, so `'B'` comes before `'a'`).
- If there are fewer than `k` distinct strings, return all of them in that order. `k` of `0` gives `[]`.
- `k` must be a non-negative integer, otherwise throw a `RangeError`.
- `items` must be an array of strings, otherwise throw a `TypeError`.
- The input is never modified.

Example: `topK(['b', 'a', 'b', 'c', 'a', 'b'], 2)` is `['b', 'a']`.

Keep it dependency free.
