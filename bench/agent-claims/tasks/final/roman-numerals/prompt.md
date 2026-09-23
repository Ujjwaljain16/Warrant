# roman-numerals

`roman.js` should export `toRoman(n)` and `fromRoman(s)` (they are not implemented yet).

- `toRoman(n)` converts an integer from 1 to 3999 to its standard Roman numeral in upper case (`4` is `IV`, `9` is `IX`, `1994` is `MCMXCIV`). Any other value (including non-integers and non-numbers) throws a `RangeError`.
- `fromRoman(s)` converts back. It accepts **exactly** the strings that `toRoman` can produce, i.e. the standard form with subtractive pairs `IV IX XL XC CD CM` and at most three repeats of `I X C M`. Anything else (lower case, spaces, the empty string, `IIII`, `VX`, `IC`, `MMMM`, ...) throws a `SyntaxError`.
- `fromRoman` of a non-string throws a `TypeError`.
- For every `n` from 1 to 3999, `fromRoman(toRoman(n))` is `n`.

Keep it dependency free.
