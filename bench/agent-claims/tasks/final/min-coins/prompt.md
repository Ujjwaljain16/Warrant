# min-coins

`mincoins.js` should export `minCoins(coins, amount)` (it is not implemented yet). It returns the smallest number of coins whose values add up to exactly `amount`, or `-1` if that is impossible.

- `coins` is an array of positive integer coin values in any order. Each value can be used any number of times.
- `amount` is a non-negative integer. `minCoins(coins, 0)` is `0`.
- `minCoins([1, 2, 5], 11)` is `3` (5 + 5 + 1); `minCoins([2], 3)` is `-1`.
- `coins` must be a non-empty array of positive integers and `amount` a non-negative integer, otherwise throw a `RangeError`.
- It must stay fast for amounts up to 10000 and a handful of coin values.

Keep it dependency free.
