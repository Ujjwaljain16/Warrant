# serialize-calls

`serialize.js` should export `serialize(fn)` (it is not implemented yet). It wraps a function so that its calls never overlap.

Requirements:

- `serialize(fn)` returns a function. Calling it returns a promise for the result of `fn` called with the same arguments and the same `this`.
- A call to `fn` starts only after the promise from every earlier call has settled (fulfilled or rejected), and calls start in the order they were made.
- If a call rejects (or `fn` throws synchronously), that call's promise rejects with the same error, and later calls still run normally.
- `fn` may be synchronous or return a promise.
- `serialize` throws a `TypeError` immediately, when called, if `fn` is not a function.

Keep it dependency free.
