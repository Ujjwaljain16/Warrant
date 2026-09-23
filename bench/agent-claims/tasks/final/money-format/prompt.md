# money-format

`money.js` should export `formatMoney(amount, currency)` (it is not implemented yet). `amount` is an integer number of the currency's smallest unit; `currency` defaults to `'USD'`.

Currencies:

| code | symbol | decimals | the amount is in |
|---|---|---|---|
| `USD` | `$` | 2 | cents |
| `EUR` | `€` | 2 | cents |
| `GBP` | `£` | 2 | pence |
| `JPY` | `¥` | 0 | yen |

Format: the symbol, the whole part with a comma between groups of three digits, and (for two decimals) a dot and exactly two digits. A negative amount puts a minus sign **before** the symbol.

Examples: `formatMoney(123456)` is `'$1,234.56'`; `formatMoney(5)` is `'$0.05'`; `formatMoney(-5)` is `'-$0.05'`; `formatMoney(1234567, 'JPY')` is `'¥1,234,567'`; `formatMoney(0)` is `'$0.00'`.

- `amount` must be a safe integer (`Number.isSafeInteger`), otherwise throw a `RangeError`. An unknown currency code (anything not in the table, including inherited names like `'toString'`) throws a `RangeError`.
- Do not use floating point division for the result; amounts up to the safe-integer limit must format exactly.

Keep it dependency free.
