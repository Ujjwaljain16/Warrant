# promise-pool

`pool.js` should export `pool(items, worker, limit)` (it is not implemented yet). It is an `async` function (it never throws synchronously) that runs `worker(item, index)` for every item with at most `limit` calls in flight at the same time, and resolves with the array of results in the **input order**.

- Start jobs in input order. As soon as any running job finishes, start the next waiting item (do not wait for a whole batch to finish).
- `worker` may return a plain value or a promise, or throw.
- If a job rejects (or throws), the returned promise rejects with that same error as soon as it happens, and **no further jobs are started**. Jobs already running are not cancelled.
- If `limit` is larger than the number of items, all items start at once. An empty `items` array resolves to `[]`.
- Invalid arguments make the returned promise reject: `items` not an array or `worker` not a function with a `TypeError`; `limit` not a positive integer with a `RangeError`.

Keep it dependency free.
