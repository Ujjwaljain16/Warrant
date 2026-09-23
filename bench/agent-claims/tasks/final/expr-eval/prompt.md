# expr-eval

`expr.js` should export `evaluate(text)` (it is not implemented yet). It evaluates an arithmetic expression given as a string and returns a number. It must **not** use `eval`, `new Function` or similar.

Grammar:

- Numbers: digits with an optional fractional part, such as `3`, `3.25` or `.5`. (No exponent notation, no hex.)
- Binary operators `+ - * / % ^` and parentheses. Whitespace between tokens is ignored.
- Unary `-` and `+` may be applied to a factor, and may repeat (`--3` is `3`).

Precedence, from tightest to loosest:

1. `^` (power), **right-associative**: `2 ^ 3 ^ 2` is `2 ^ 9 = 512`. The exponent may carry a unary sign: `2 ^ -1` is `0.5`.
2. unary `-` and `+`, which bind **looser** than `^`: `-2 ^ 2` is `-4`.
3. `*` `/` `%`, left-associative. `%` is the JavaScript remainder (`-5 % 3` is `-2`).
4. `+` `-`, left-associative.

Errors:

- Dividing by zero, or taking a remainder by zero, throws a `RangeError`.
- Anything that is not a well-formed expression (empty or blank input, unbalanced parentheses, a missing operand, two numbers in a row, an unknown character, `3.`) throws a `SyntaxError`.
- A non-string throws a `TypeError`.

Keep it dependency free.
