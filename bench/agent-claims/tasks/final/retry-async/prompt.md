# retry-async

`retry.js` should export `retry(fn, options)` (it is not implemented yet). It is an `async` function that calls `fn` until it succeeds or the attempts run out.

Options (all optional):

- `retries` (default `3`): how many times to retry after the first failure. The total number of attempts is `retries + 1`.
- `delayMs` (default `100`): the wait after the first failure.
- `factor` (default `2`): each later wait is `factor` times the previous one. So after the k-th failure (k = 1, 2, ...) it waits `delayMs * factor^(k-1)` milliseconds.
- `sleep(ms)` (default: a `setTimeout`-based promise): how to wait. It is called with the number of milliseconds and returns a promise. It is injectable so tests need no real waiting.
- `shouldRetry(error, attempt)` (default: always retry): if it returns `false` after an attempt failed, stop at once and reject with that attempt's error.

Behaviour:

- `fn` is called with the attempt number (the first attempt is `1`). It may be synchronous or return a promise; a synchronous throw counts as a failed attempt.
- As soon as an attempt succeeds, `retry` resolves with its value (no waiting after a success).
- After the last allowed attempt fails, `retry` rejects with that last error. It does **not** wait after the last failure, and it does not call `sleep` for it.
- Invalid arguments make the returned promise reject: `fn` not a function (`TypeError`); `retries` not a non-negative integer, `delayMs` not a finite number of at least 0, or `factor` not a finite number of at least 1 (`RangeError`).

Keep it dependency free.
