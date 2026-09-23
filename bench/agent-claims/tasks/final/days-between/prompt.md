# days-between

`daysbetween.js` exports `daysBetween(from, to)`. Both arguments are calendar dates written `YYYY-MM-DD`. It returns how many calendar days the span from `from` to `to` covers, counting **both** the first and the last day.

Requirements:

- The same day twice gives `1`; `2024-01-01` to `2024-01-10` gives `10`.
- Leap years follow the Gregorian rules (divisible by 4, except centuries that are not divisible by 400). `2024-02-28` to `2024-03-01` gives `3`.
- If `to` is earlier than `from`, throw a `RangeError`.
- A string that is not exactly four digits, a dash, two digits, a dash and two digits, or that names a day that does not exist (such as `2023-02-29` or `2024-04-31`), throws a `RangeError`.
- A non-string argument throws a `TypeError`.
- Only years 1000 to 9999 need to work.

The current implementation is wrong. Fix `daysbetween.js`. Keep it dependency free.
