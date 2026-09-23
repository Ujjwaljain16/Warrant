# token-bucket

`bucket.js` should export a class `TokenBucket` (it is not implemented yet). It limits how often something may happen. Time is passed in explicitly (in milliseconds) so the class is deterministic.

- `new TokenBucket(capacity, refillPerSecond)`: both must be finite numbers greater than 0, otherwise throw a `RangeError`. The bucket starts full (it holds `capacity` tokens).
- Tokens are added continuously at `refillPerSecond` per second, including fractions of a token, but the bucket never holds more than `capacity`. Refill is computed from the time that has passed since the previous call that was given a time. The first call only sets that starting time (no refill happens before it).
- `tryTake(nowMs, n = 1)`: if at least `n` tokens are available at `nowMs`, remove `n` and return `true`. Otherwise remove nothing and return `false`. `n` must be a positive integer, otherwise throw a `RangeError` (an `n` larger than the capacity is valid; it simply always returns `false`).
- `available(nowMs)`: the number of tokens (possibly fractional) available at `nowMs`. It consumes nothing.
- If `nowMs` is earlier than the latest time seen so far, no refill happens and the latest time stays as it was (the clock never runs backwards).
- `nowMs` must be a finite number, otherwise throw a `TypeError`.

Keep it dependency free.
