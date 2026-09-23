# business-days

`bizdays.js` should export `addBusinessDays(date, n)` (it is not implemented yet). `date` is a string `YYYY-MM-DD` and `n` an integer (positive, negative or zero). It returns a date string in the same format.

Rule: moving by `n` business days means taking `|n|` steps. Each step moves one calendar day forward (if `n` is positive) or backward (if `n` is negative), and then keeps moving in the same direction until it lands on a weekday (Monday to Friday). There are no holidays. With `n` of `0` the date is returned unchanged, even if it is a Saturday or Sunday.

Consequences: from a Friday, one step forward lands on Monday; from a Saturday or Sunday, one step forward lands on Monday; from a Monday, one step backward lands on the Friday before; from a Sunday, one step backward lands on Friday.

- Days of the week and dates follow the proleptic Gregorian calendar in UTC. `2024-01-01` is a Monday.
- A `date` that is not exactly `YYYY-MM-DD` with a real calendar day, or whose year (before or after the move) is outside 1000-9999, throws a `RangeError`. A non-string `date` throws a `TypeError`. `n` must be a safe integer, otherwise throw a `RangeError`.
- It must handle `n` up to 100000 in either direction quickly.

Keep it dependency free.
