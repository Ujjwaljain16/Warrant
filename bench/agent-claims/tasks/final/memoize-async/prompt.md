# memoize-async

`memo.js` should export `memoizeAsync(fn, keyFn)` (it is not implemented yet). It returns a function that calls `fn` at most once per key while a call is pending or has succeeded.

- The returned function always returns a promise. The key of a call is `keyFn(...args)` if `keyFn` is given, otherwise the first argument. Keys are compared like `Map` keys.
- If a call with the same key is **already in progress**, the caller gets the same promise as that call; `fn` is not called again.
- After a call fulfills, later calls with that key return the cached value without calling `fn`.
- If a call rejects (or `fn` throws), nothing is cached for that key: everyone waiting on that call sees the rejection, and the next call with that key calls `fn` again.
- Different keys are independent. `fn` receives all the arguments of the call that triggered it.
- `fn` must be a function and `keyFn`, when given, a function; otherwise `memoizeAsync` throws a `TypeError` immediately.

Keep it dependency free.
