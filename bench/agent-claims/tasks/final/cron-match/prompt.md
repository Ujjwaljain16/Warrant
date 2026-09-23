# cron-match

`cron.js` should export `cronMatches(expression, date)` (it is not implemented yet). It tells whether a `Date` matches a five-field cron expression, evaluated in **UTC** (use `getUTCMinutes()`, `getUTCHours()`, `getUTCDate()`, `getUTCMonth() + 1`, `getUTCDay()`).

Fields, separated by one or more whitespace characters (leading and trailing whitespace is ignored), in this order and with these ranges:

| field | allowed values |
|---|---|
| minute | 0-59 |
| hour | 0-23 |
| day of month | 1-31 |
| month | 1-12 |
| day of week | 0-6, where 0 is Sunday (7 is **not** allowed) |

Each field is a comma-separated list of items. An item is:

- `*`: every value in the field's range,
- `N`: one value,
- `A-B`: every value from A to B inclusive (A must not exceed B),
- `*/S` or `A-B/S`: every S-th value starting from the first one of the range, where S is a positive integer. (`N/S` with a single number is **not** allowed.)

Matching rule: the minute, hour and month fields must all match. For the day there is a special rule. If **neither** the day-of-month field nor the day-of-week field starts with `*`, the day matches when **either** of them matches (so `0 0 13 * 5` is every 13th and also every Friday). If at least one of the two fields starts with `*` (such as `*` or `*/2`), the day matches only when **both** fields match (a plain `*` always matches).

Errors: an expression with other than five fields, a value outside its range, a malformed item, a reversed range, or a step of 0 throws a `SyntaxError`. A non-string expression, or a `date` that is not a valid `Date`, throws a `TypeError`.

Keep it dependency free.
